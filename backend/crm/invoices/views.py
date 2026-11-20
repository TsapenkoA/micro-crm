import re
from decimal import Decimal
from django.db import transaction
from django.db.models import Count, DecimalField, F, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce, Greatest
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
from crm.activity.services import log_activity, snapshot
from crm.invoices.delivery import DeliveryConflict, reminder_blocker, reminder_copy, prepare_invoice_email
from crm.invoices.serializers import InvoiceCancelSerializer, InvoiceDueDateCorrectionInputSerializer, InvoiceListSerializer, InvoiceOutputSerializer, InvoicePaymentInputSerializer, InvoicePaymentVoidSerializer, InvoiceStatusSerializer, InvoiceWriteSerializer
from crm.invoices.services import buyer_snapshot, invoice_number, issue_invoice, record_payment, recorded_total
from crm.models import Client, Deal, Invoice, InvoiceDelivery, InvoiceDueDateCorrection, InvoiceItem, InvoicePayment, Workspace, WorkspaceMembership
from crm.services.calculations import CURRENCY_PLACES, calculate_items, money_string
from crm.services.pdf import render_invoice


class InvoiceQuerysetMixin(WorkspaceQuerysetMixin):
    queryset = Invoice.objects.order_by("-created_at", "-id")
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get_queryset(self):
        queryset = super().get_queryset().filter(client__workspace_id=self.request.workspace_id).select_related("client", "deal")
        if self.request.method == "GET" and not self.kwargs.get("pk"):
            return queryset.prefetch_related("items")
        return queryset.prefetch_related("items", "payments", "deliveries", "due_date_corrections")

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


class InvoiceSummary(InvoiceQuerysetMixin, generics.GenericAPIView):
    def get(self, request):
        currency = request.query_params.get("currency", "USD")
        if currency not in CURRENCY_PLACES:
            raise ValidationError({"currency": "Unsupported invoice currency."})
        paid = InvoicePayment.objects.filter(invoice_id=OuterRef("pk"), voided_at__isnull=True).values("invoice_id").annotate(total=Sum("amount")).values("total")
        zero = Value(Decimal("0"), output_field=DecimalField(max_digits=20, decimal_places=4))
        queryset = self.get_queryset().filter(currency=currency).annotate(
            paid_value=Coalesce(Subquery(paid), zero),
        ).annotate(balance=Greatest(F("total_amount") - F("paid_value"), zero))
        overdue = Q(status=Invoice.Status.SENT, due_date__lt=timezone.localdate(), balance__gt=0)
        rows = {
            "sent": queryset.filter(status=Invoice.Status.SENT).aggregate(count=Count("pk"), amount=Sum("balance")),
            "paid": queryset.filter(paid_value__gt=0).aggregate(count=Count("pk"), amount=Sum("paid_value")),
            "draft": queryset.filter(status=Invoice.Status.DRAFT).aggregate(count=Count("pk"), amount=Sum("total_amount")),
            "overdue": queryset.filter(overdue).aggregate(count=Count("pk"), amount=Sum("balance")),
        }
        return Response({"currency": currency, **{
            key: {"count": row["count"], "amount": money_string(row["amount"] or Decimal("0"), currency)}
            for key, row in rows.items()
        }})


class InvoiceList(InvoiceQuerysetMixin, generics.ListCreateAPIView):
    pagination_class = ClientPagination
    filter_backends = [filters.SearchFilter]
    search_fields = ["invoice_number", "client__name", "client__company"]

    def get_serializer_class(self):
        return InvoiceWriteSerializer if self.request.method == "POST" else InvoiceListSerializer

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
        log_activity(invoice, request.user, "created")
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
        before = snapshot(invoice)
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
        log_activity(invoice, request.user, "edited", before)
        invoice._prefetched_objects_cache = {}
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoiceStatus(InvoiceDetail):
    http_method_names = ["patch", "options"]

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=kwargs["pk"])
        before = snapshot(invoice)
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
            payment = record_payment(invoice, request.user, remaining, timezone.localdate())
        else:
            raise ValidationError({"status": "This invoice status transition is not allowed."})
        if target == Invoice.Status.PAID:
            log_activity(invoice, request.user, "payment_recorded", before, {"payment_amount": money_string(payment.amount, invoice.currency), "received_on": payment.received_on.isoformat()})
        else:
            log_activity(invoice, request.user, "updated", before)
        invoice._prefetched_objects_cache = {}
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoicePayments(InvoiceQuerysetMixin, generics.GenericAPIView):
    @transaction.atomic
    def post(self, request, pk):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
        before = snapshot(invoice)
        serializer = InvoicePaymentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        payment = record_payment(invoice, request.user, values["amount"], values.get("received_on", timezone.localdate()), values.get("reference", ""))
        log_activity(invoice, request.user, "payment_recorded", before, {"payment_amount": money_string(payment.amount, invoice.currency), "received_on": payment.received_on.isoformat()})
        invoice._prefetched_objects_cache = {}
        return Response(InvoiceOutputSerializer(invoice).data, status=201)


class InvoicePaymentVoid(InvoiceQuerysetMixin, generics.GenericAPIView):
    @transaction.atomic
    def post(self, request, pk, payment_id):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
        payment = get_object_or_404(InvoicePayment.objects.select_for_update(), pk=payment_id, invoice=invoice)
        values = InvoicePaymentVoidSerializer(data=request.data)
        values.is_valid(raise_exception=True)
        if payment.voided_at is not None or payment.is_legacy or invoice.status not in (Invoice.Status.SENT, Invoice.Status.PAID):
            raise ValidationError({"payment": "This payment cannot be reversed."})
        before = snapshot(invoice)
        payment.voided_at = timezone.now()
        payment.voided_by = request.user
        payment.void_reason = values.validated_data["reason"]
        payment.save(update_fields=["voided_at", "voided_by", "void_reason"])
        invoice._prefetched_objects_cache = {}
        if invoice.status == Invoice.Status.PAID:
            invoice.status = Invoice.Status.SENT
            invoice.paid_at = None
            invoice.fx_rate_date = None
            invoice.save(update_fields=["status", "paid_at", "fx_rate_date", "updated_at"])
        log_activity(invoice, request.user, "payment_reversed", before, {"payment_id": str(payment.pk)})
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoiceDueDateCorrections(InvoiceQuerysetMixin, generics.GenericAPIView):
    @transaction.atomic
    def post(self, request, pk):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
        values = InvoiceDueDateCorrectionInputSerializer(data=request.data)
        values.is_valid(raise_exception=True)
        due_date = values.validated_data["due_date"]
        if invoice.status != Invoice.Status.SENT:
            raise ValidationError({"status": "Only sent invoices can have their due date corrected."})
        if due_date == invoice.due_date or (invoice.issued_at and due_date < timezone.localtime(invoice.issued_at).date()):
            raise ValidationError({"due_date": "Choose a different date on or after the issue date."})
        before = snapshot(invoice)
        InvoiceDueDateCorrection.objects.create(
            invoice=invoice, corrected_by=request.user, previous_due_date=invoice.due_date,
            due_date=due_date, reason=values.validated_data["reason"],
        )
        invoice.due_date = due_date
        invoice.save(update_fields=["due_date", "updated_at"])
        log_activity(invoice, request.user, "due_date_corrected", before)
        invoice._prefetched_objects_cache = {}
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoiceCancel(InvoiceQuerysetMixin, generics.GenericAPIView):
    @transaction.atomic
    def post(self, request, pk):
        self.lock_membership()
        invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
        before = snapshot(invoice)
        serializer = InvoiceCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if invoice.status not in (Invoice.Status.DRAFT, Invoice.Status.SENT) or invoice.payments.filter(voided_at__isnull=True).exists():
            raise ValidationError({"status": "Only an unpaid draft or sent invoice can be cancelled."})
        invoice.status = Invoice.Status.CANCELLED
        invoice.cancelled_at = timezone.now()
        invoice.cancellation_reason = serializer.validated_data["reason"]
        invoice.save()
        log_activity(invoice, request.user, "updated", before)
        return Response(InvoiceOutputSerializer(invoice).data)


class InvoiceSend(InvoiceQuerysetMixin, generics.GenericAPIView):
    def post(self, request, pk):
        with transaction.atomic():
            self.lock_membership()
            invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
            if invoice.status not in (Invoice.Status.DRAFT, Invoice.Status.SENT):
                raise ValidationError({"status": "Only draft or sent invoices can be emailed."})
            if invoice.deliveries.filter(kind=InvoiceDelivery.Kind.INVOICE, result__in=[InvoiceDelivery.Result.ACCEPTED, InvoiceDelivery.Result.PENDING, InvoiceDelivery.Result.UNKNOWN]).exists():
                raise DeliveryConflict()
            if not invoice.items.exists():
                raise ValidationError({"items": "At least one item is required before sending."})
            before = snapshot(invoice)
            issue_invoice(invoice)
            message = prepare_invoice_email(invoice, InvoiceDelivery.Kind.INVOICE)
            delivery = InvoiceDelivery.objects.create(invoice=invoice, requested_by=request.user, kind=InvoiceDelivery.Kind.INVOICE, recipient=message.to[0], result=InvoiceDelivery.Result.PENDING)
            log_activity(invoice, request.user, "updated", before)
        return complete_delivery(invoice, delivery, message, request.user, "email_sent")


class InvoiceReminder(InvoiceQuerysetMixin, generics.GenericAPIView):
    def get(self, request, pk):
        invoice = get_object_or_404(self.get_queryset(), pk=pk)
        if invoice.due_date is None:
            raise ValidationError({"due_date": "Set a due date before sending a reminder."})
        subject, body = reminder_copy(invoice)
        blocker = reminder_blocker(invoice)
        return Response({"subject": subject, "body": body, "can_send": not blocker, "reason": blocker})

    def post(self, request, pk):
        with transaction.atomic():
            self.lock_membership()
            invoice = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
            blocker = reminder_blocker(invoice)
            if blocker:
                raise ValidationError({"reminder": blocker})
            message = prepare_invoice_email(invoice, InvoiceDelivery.Kind.REMINDER)
            delivery = InvoiceDelivery.objects.create(invoice=invoice, requested_by=request.user, kind=InvoiceDelivery.Kind.REMINDER, recipient=message.to[0], result=InvoiceDelivery.Result.PENDING)
        return complete_delivery(invoice, delivery, message, request.user, "reminder_sent")


def complete_delivery(invoice, delivery, message, actor, activity_action):
    try:
        accepted = message.send(fail_silently=False)
    except Exception:
        result = InvoiceDelivery.Result.UNKNOWN
    else:
        result = InvoiceDelivery.Result.ACCEPTED if accepted == 1 else InvoiceDelivery.Result.FAILED
    with transaction.atomic():
        delivery.result = result
        delivery.save(update_fields=["result"])
        if result == InvoiceDelivery.Result.ACCEPTED:
            log_activity(invoice, actor, activity_action)
    invoice._prefetched_objects_cache = {}
    if result == InvoiceDelivery.Result.UNKNOWN:
        return Response({"error": {"code": 503, "details": "The email outcome is unknown. Contact support before retrying."}}, status=503)
    if result == InvoiceDelivery.Result.FAILED:
        return Response({"error": {"code": 503, "details": "The mail server did not accept the email. You can retry."}}, status=503)
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
        response["Cache-Control"] = "private, no-store"
        return response
