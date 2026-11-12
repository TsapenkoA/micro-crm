import re
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import filters, generics, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import serializers
from crm.api.pagination import ClientPagination
from crm.api.permissions import IsWorkspaceMember, WorkspaceQuerysetMixin
from crm.invoices.delivery import DeliveryConflict, reminder_blocker, reminder_copy, send_invoice_email
from crm.invoices.serializers import InvoiceCancelSerializer, InvoiceOutputSerializer, InvoicePaymentInputSerializer, InvoiceStatusSerializer, InvoiceWriteSerializer
from crm.invoices.services import buyer_snapshot, invoice_number, issue_invoice, record_payment, recorded_total
from crm.models import Client, Deal, Invoice, InvoiceDelivery, InvoiceItem, Workspace, WorkspaceMembership
from crm.services.calculations import CURRENCY_PLACES, calculate_items
from crm.services.pdf import render_invoice


class InvoiceQuerysetMixin(WorkspaceQuerysetMixin):
    queryset = Invoice.objects.order_by("-created_at", "-id")
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get_queryset(self):
        return super().get_queryset().filter(client__workspace_id=self.request.workspace_id).select_related("client", "deal").prefetch_related("items", "payments", "deliveries")

    def lock_membership(self):
        membership = WorkspaceMembership.objects.select_for_update().filter(user=self.request.user, workspace_id=self.request.workspace_id).first()
        if membership is None:
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")

    def lock_client(self, client):
        return get_object_or_404(Client.objects.select_for_update(), pk=client.pk, workspace_id=self.request.workspace_id)

    def lock_deal(self, deal, client):
        if deal is None:
            return None
        locked = get_object_or_404(Deal.objects.select_for_update(), pk=deal.pk, workspace_id=self.request.workspace_id)
        if locked.client_id != client.pk:
            raise ValidationError({"deal": "Choose a deal for this client."})
        return locked

    def calculated_items(self, items, currency):
        try:
            return calculate_items(items, currency)
        except ValueError as exc:
            raise ValidationError({"items": str(exc)}) from exc

    def save_items(self, invoice, calculated):
        for position, item in enumerate(calculated):
            InvoiceItem.objects.create(invoice=invoice, position=position, **item)


class InvoiceList(InvoiceQuerysetMixin, generics.ListCreateAPIView):
    pagination_class = ClientPagination
    filter_backends = [filters.SearchFilter]
    search_fields = ["invoice_number", "client__name", "client__company"]

    def get_serializer_class(self):
        return InvoiceWriteSerializer if self.request.method == "POST" else InvoiceOutputSerializer

    def filter_queryset(self, queryset):
        status_filter = self.request.query_params.get("status")
        currency = self.request.query_params.get("currency")
        deal = self.request.query_params.get("deal")
        overdue = self.request.query_params.get("overdue")
        if status_filter and status_filter not in Invoice.Status.values:
            raise ValidationError({"status": "Unknown invoice status."})
        if currency and currency not in CURRENCY_PLACES:
            raise ValidationError({"currency": "Unsupported invoice currency."})
        if overdue and overdue != "true":
            raise ValidationError({"overdue": "Use true to filter overdue invoices."})
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if currency:
            queryset = queryset.filter(currency=currency)
        if deal:
            queryset = queryset.filter(deal_id=serializers.UUIDField().run_validation(deal))
        if overdue:
            queryset = queryset.filter(status=Invoice.Status.SENT, due_date__lt=timezone.localdate())
        return super().filter_queryset(queryset)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        self.lock_membership()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        workspace = Workspace.objects.select_for_update().get(pk=request.workspace_id)
        client = self.lock_client(values["client"])
        deal = self.lock_deal(values.get("deal"), client)
        calculated, subtotal, tax_total, total_amount = self.calculated_items(values["items"], values["currency"])
        seller = values.get("seller") or workspace.seller_details or {"name": workspace.name, "email": request.user.email}
        if workspace.bank_details:
            seller = {**seller, "bank_details": workspace.bank_details}
        invoice = Invoice.objects.create(
            workspace=workspace, created_by=request.user, client=client, deal=deal,
            invoice_number=invoice_number(workspace.pk), currency=values["currency"],
            due_date=values.get("due_date"), payment_terms=values.get("payment_terms", ""),
            seller_snapshot=seller, buyer_snapshot=buyer_snapshot(client),
            subtotal=subtotal, tax_total=tax_total, total_amount=total_amount,
        )
        self.save_items(invoice, calculated)
        return Response(InvoiceOutputSerializer(invoice).data, status=status.HTTP_201_CREATED)


class InvoiceDetail(InvoiceQuerysetMixin, generics.RetrieveUpdateAPIView):
    http_method_names = ["get", "patch", "options"]

    def get_serializer_class(self):
        return InvoiceWriteSerializer if self.request.method == "PATCH" else InvoiceOutputSerializer

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=kwargs["pk"])
        if invoice.status != Invoice.Status.DRAFT:
            raise ValidationError({"status": "Only draft invoices can be edited."})
        serializer = self.get_serializer(instance=invoice, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        client = self.lock_client(values["client"]) if "client" in values else invoice.client
        deal = self.lock_deal(values.get("deal", invoice.deal), client)
        currency = values.get("currency", invoice.currency)
        items = values.get("items")
        if items is None:
            items = [dict(description=item.description, quantity=item.quantity, unit_price=item.unit_price, tax_rate=item.tax_rate) for item in invoice.items.all()]
        calculated, subtotal, tax_total, total_amount = self.calculated_items(items, currency)
        invoice.client = client
        invoice.deal = deal
        invoice.currency = currency
        invoice.due_date = values.get("due_date", invoice.due_date)
        invoice.payment_terms = values.get("payment_terms", invoice.payment_terms)
        invoice.subtotal = subtotal
        invoice.tax_total = tax_total
        invoice.total_amount = total_amount
        if "client" in values:
            invoice.buyer_snapshot = buyer_snapshot(client)
        if "seller" in values:
            invoice.seller_snapshot = {**values["seller"], **({"bank_details": invoice.seller_snapshot["bank_details"]} if invoice.seller_snapshot.get("bank_details") else {})}
        invoice.save()
        invoice.items.all().delete()
        self.save_items(invoice, calculated)
        invoice._prefetched_objects_cache = {}
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoiceStatus(InvoiceDetail):
    http_method_names = ["patch", "options"]

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=kwargs["pk"])
        serializer = InvoiceStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = serializer.validated_data["status"]
        if invoice.status == Invoice.Status.DRAFT and target == Invoice.Status.SENT:
            if not invoice.items.exists():
                raise ValidationError({"items": "At least one item is required before sending."})
            issue_invoice(invoice)
        elif invoice.status == Invoice.Status.SENT and target == Invoice.Status.PAID:
            remaining = invoice.total_amount - recorded_total(invoice)
            if remaining <= 0:
                raise ValidationError({"status": "There is no balance to record."})
            record_payment(invoice, request.user, remaining, timezone.localdate())
        else:
            raise ValidationError({"status": "This invoice status transition is not allowed."})
        invoice._prefetched_objects_cache = {}
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoicePayments(InvoiceQuerysetMixin, generics.GenericAPIView):
    @transaction.atomic
    def post(self, request, pk):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
        serializer = InvoicePaymentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        record_payment(invoice, request.user, values["amount"], values.get("received_on", timezone.localdate()), values.get("reference", ""))
        invoice._prefetched_objects_cache = {}
        return Response(InvoiceOutputSerializer(invoice).data, status=201)


class InvoiceCancel(InvoiceQuerysetMixin, generics.GenericAPIView):
    @transaction.atomic
    def post(self, request, pk):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
        serializer = InvoiceCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if invoice.status not in (Invoice.Status.DRAFT, Invoice.Status.SENT) or invoice.payments.exists():
            raise ValidationError({"status": "Only an unpaid draft or sent invoice can be cancelled."})
        invoice.status = Invoice.Status.CANCELLED
        invoice.cancelled_at = timezone.now()
        invoice.cancellation_reason = serializer.validated_data["reason"]
        invoice.save()
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoiceSend(InvoiceQuerysetMixin, generics.GenericAPIView):
    @transaction.atomic
    def post(self, request, pk):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
        if invoice.status not in (Invoice.Status.DRAFT, Invoice.Status.SENT):
            raise ValidationError({"status": "Only draft or sent invoices can be emailed."})
        if invoice.deliveries.filter(kind=InvoiceDelivery.Kind.INVOICE, result=InvoiceDelivery.Result.ACCEPTED).exists():
            raise DeliveryConflict()
        if not invoice.items.exists():
            raise ValidationError({"items": "At least one item is required before sending."})
        issue_invoice(invoice)
        delivery = send_invoice_email(invoice, request.user, InvoiceDelivery.Kind.INVOICE)
        invoice._prefetched_objects_cache = {}
        if delivery.result == InvoiceDelivery.Result.FAILED:
            return Response({"error": {"code": 503, "details": "The mail server did not accept the invoice. You can retry."}}, status=503)
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoiceReminder(InvoiceQuerysetMixin, generics.GenericAPIView):
    def get(self, request, pk):
        invoice = get_object_or_404(self.get_queryset(), pk=pk)
        if invoice.due_date is None:
            raise ValidationError({"due_date": "Set a due date before sending a reminder."})
        subject, body = reminder_copy(invoice)
        blocker = reminder_blocker(invoice)
        return Response({"subject": subject, "body": body, "can_send": not blocker, "reason": blocker})

    @transaction.atomic
    def post(self, request, pk):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
        blocker = reminder_blocker(invoice)
        if blocker:
            raise ValidationError({"reminder": blocker})
        delivery = send_invoice_email(invoice, request.user, InvoiceDelivery.Kind.REMINDER)
        invoice._prefetched_objects_cache = {}
        if delivery.result == InvoiceDelivery.Result.FAILED:
            return Response({"error": {"code": 503, "details": "The mail server did not accept the reminder. You can retry."}}, status=503)
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoicePDF(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request, pk):
        invoice = get_object_or_404(
            Invoice.objects.filter(workspace_id=request.workspace_id, client__workspace_id=request.workspace_id).prefetch_related("items"),
            pk=pk,
        )
        response = HttpResponse(render_invoice(invoice), content_type="application/pdf")
        filename = re.sub(r"[^A-Za-z0-9_-]", "_", invoice.invoice_number)[:50] or "invoice"
        response["Content-Disposition"] = f'attachment; filename="{filename}.pdf"'
        return response
