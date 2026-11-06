from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
import logging
import re
import time
import uuid

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login as session_login, logout as session_logout, update_session_auth_hash
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import transaction, DatabaseError, connection
from django.db.models import Count, Q, F, Sum
from django.db.models.deletion import ProtectedError
from django.db.models.functions import TruncMonth, TruncQuarter
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET

from allauth.socialaccount.models import SocialAccount
from rest_framework import serializers, filters, generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied, APIException, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from crm.services.calculations import CURRENCY_PLACES, calculate_items, money_string
from crm.models import Client, Deal, Invoice, PreviewDataset, Workspace, WorkspaceMembership, InvoiceItem
from crm.services.pdf import render_invoice
from crm.api.permissions import IsWorkspaceMember, WorkspaceQuerysetMixin
from crm.auth.security import AuthThrottle, email_in_use, email_lock, email_user, recent_auth
from crm.api.serializers import (
    LoginSerializer,
    check_password,
    SignupSerializer,
    EmailSerializer,
    ResetSerializer,
    UsernameSerializer,
    NewPasswordSerializer,
    DashboardFilters,
    ClientDetailSerializer,
    ClientLinkSerializer,
    ClientListSerializer,
    ClientNoteSerializer,
    ClientSerializer,
    DealDeleteSerializer,
    DealFilters,
    DealSerializer,
    DealStatusSerializer,
    InvoiceOutputSerializer,
    InvoiceStatusSerializer,
    InvoiceWriteSerializer,
)


logger = logging.getLogger(__name__)


def user_data(user):
    membership = WorkspaceMembership.objects.select_related("workspace").filter(user=user).first()
    workspace = {"id": str(membership.workspace_id), "name": membership.workspace.name} if membership else None
    return {"id": user.pk, "username": user.username, "email": user.email, "workspace": workspace}


@api_view(["GET"])
@permission_classes([AllowAny])
def csrf(request):
    return Response({"csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class PublicAuthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [AuthThrottle]


class LoginView(PublicAuthView):
    rate_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        identifier = fields.get("email") or fields["username"]
        candidate = email_user(identifier) if "@" in identifier else None
        username = candidate.username if candidate else (uuid.uuid4().hex if "@" in identifier else identifier)
        user = authenticate(request, username=username, password=fields["password"])
        if user is None:
            return Response({"error": {"code": 403, "details": "Invalid credentials."}}, status=403)
        session_login(request, user)
        return Response({"user": user_data(user), "csrfToken": get_token(request)})


login = LoginView.as_view()


@api_view(["POST"])
def logout(request):
    session_logout(request)
    return Response(status=204)


@api_view(["GET"])
def me(request):
    return Response({"user": user_data(request.user)})


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsWorkspaceMember])
def workspace_counts(request):
    workspace_id = request.workspace_id
    return Response({
        "clients": Client.objects.filter(workspace_id=workspace_id).count(),
        "deals": Deal.objects.filter(workspace_id=workspace_id).count(),
        "invoices": Invoice.objects.filter(workspace_id=workspace_id).count(),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsWorkspaceMember])
def preview_dataset(request):
    payload = PreviewDataset.objects.filter(workspace_id=request.workspace_id).values_list("payload", flat=True).first()
    if payload is None:
        raise NotFound("No preview is available for this workspace.")
    return Response(payload)


@method_decorator(csrf_protect, name="dispatch")
class SignupView(PublicAuthView):
    rate_scope = "signup"

    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        email = fields["email"].casefold()
        if len(email) > 254:
            raise serializers.ValidationError({"email": ["Use 254 characters or fewer."]})
        User = get_user_model()
        with email_lock(email), email_lock("username:" + fields["username"]):
            if email_in_use(email):
                raise serializers.ValidationError({"email": ["Unable to create an account with these details. Try signing in or resetting your password."]})
            try:
                username = serializer.validate_username(fields["username"])
            except serializers.ValidationError as error:
                raise serializers.ValidationError({"username": error.detail})
            user = User(username=username, email=email)
            check_password(fields["password"], user)
            user.set_password(fields["password"])
            user.save()
        session_login(request, user)
        return Response({"user": user_data(user), "csrfToken": get_token(request)}, status=201)


@method_decorator(csrf_protect, name="dispatch")
class ForgotPasswordView(PublicAuthView):
    rate_scope = "forgot"

    def post(self, request):
        serializer = EmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = email_user(serializer.validated_data["email"])
        if user and user.is_active and user.has_usable_password():
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            url = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
            body = f"Reset your Micro-CRM password using this link:\n\n{url}\n\nThis link expires in one hour. If you did not request a reset, ignore this email."
            try:
                send_mail("Reset your Micro-CRM password", body, settings.DEFAULT_FROM_EMAIL, [user.email])
            except Exception:
                logger.warning("Password reset email could not be sent.")
        return Response({"message": "If an eligible account exists, password reset instructions will be sent."}, status=202)


@method_decorator(csrf_protect, name="dispatch")
class ResetPasswordView(PublicAuthView):
    rate_scope = "reset"

    def post(self, request):
        serializer = ResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        with transaction.atomic():
            try:
                pk = urlsafe_base64_decode(fields["uid"]).decode()
                user = get_user_model().objects.select_for_update().get(pk=pk, is_active=True)
            except (ValueError, UnicodeDecodeError, OverflowError, get_user_model().DoesNotExist):
                user = None
            if not user or not user.has_usable_password() or not default_token_generator.check_token(user, fields["token"]):
                raise serializers.ValidationError({"token": ["This reset link is invalid or has expired. Request a new link."]})
            check_password(fields["password"], user)
            user.set_password(fields["password"])
            user.save(update_fields=["password"])
        session_logout(request)
        return Response({"message": "Password updated. Sign in with your new password."})


class SecurityView(APIView):
    throttle_classes = [AuthThrottle]
    rate_scope = "security"


class ProfileView(SecurityView):
    def patch(self, request):
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            serializer = UsernameSerializer(user, data=request.data)
            serializer.is_valid(raise_exception=True)
            if set(request.data) != {"username"}:
                raise serializers.ValidationError("Only username can be changed here.")
            username = serializer.validated_data["username"]
            with email_lock("username:" + username):
                try:
                    serializer.validate_username(username)
                except serializers.ValidationError as error:
                    raise serializers.ValidationError({"username": error.detail})
                old_username = user.username
                user.username = username
                user.save(update_fields=["username"])
                membership = WorkspaceMembership.objects.select_for_update().filter(user=user).first()
                if membership:
                    workspace = Workspace.objects.select_for_update().get(pk=membership.workspace_id)
                    if workspace.name == f"{old_username}'s workspace" and workspace.memberships.count() == 1:
                        workspace.name = f"{username}'s workspace"
                        workspace.save(update_fields=["name", "updated_at"])
        return Response({"user": user_data(user)})


class ReauthenticateView(SecurityView):
    def post(self, request):
        password = request.data.get("password") if isinstance(request.data, dict) else None
        if not isinstance(password, str) or len(password) > 4096 or not request.user.check_password(password):
            raise PermissionDenied("Unable to confirm your password.")
        request.session["auth_time"] = time.time()
        request.session["reauth_user"] = str(request.user.pk)
        return Response({"message": "Identity confirmed."})


class PasswordView(SecurityView):
    def post(self, request):
        serializer = NewPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            if user.has_usable_password():
                current = request.data.get("current_password")
                if not isinstance(current, str) or len(current) > 4096 or not user.check_password(current):
                    raise serializers.ValidationError({"current_password": ["Enter your current password."]})
            elif not recent_auth(request):
                raise PermissionDenied("Sign in again before setting a password.")
            check_password(fields["password"], user)
            user.set_password(fields["password"])
            user.save(update_fields=["password"])
        update_session_auth_hash(request, user)
        return Response({"message": "Password updated."})


def configured_provider(provider):
    return bool(settings.SOCIALACCOUNT_PROVIDERS.get(provider, {}).get("APPS"))


@api_view(["GET"])
@permission_classes([AllowAny])
def providers(request):
    return Response({"providers": [{"id": name, "name": label, "configured": configured_provider(name)}
                                  for name, label in [("google", "Google"), ("github", "GitHub"), ("microsoft", "Microsoft")]]})


@api_view(["GET"])
def methods(request):
    return Response({"password": request.user.has_usable_password(), "recent_auth": recent_auth(request),
                     "providers": list(SocialAccount.objects.filter(user=request.user).values_list("provider", flat=True))})


class DisconnectView(SecurityView):
    def delete(self, request, provider):
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity before disconnecting a sign-in method.")
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            accounts = SocialAccount.objects.filter(user=user)
            account = accounts.filter(provider=provider).first()
            if not account:
                raise NotFound()
            if not user.has_usable_password() and accounts.count() <= 1:
                raise serializers.ValidationError({"provider": ["Add another sign-in method before disconnecting this one."]})
            account.delete()
        return Response(status=204)


class ClientPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class ClientQuerysetMixin(WorkspaceQuerysetMixin):
    queryset = Client.objects.order_by("-created_at", "-id")
    serializer_class = ClientSerializer
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def lock_membership(self):
        membership = WorkspaceMembership.objects.select_for_update().filter(user=self.request.user, workspace_id=self.request.workspace_id).first()
        if membership is None:
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")


class ClientList(ClientQuerysetMixin, generics.ListCreateAPIView):
    pagination_class = ClientPagination
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "company", "email"]

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.annotate(deal_count=Count("deals", filter=Q(deals__workspace_id=self.request.workspace_id))) if self.request.method == "GET" else queryset

    def get_serializer_class(self):
        return ClientListSerializer if self.request.method == "GET" else super().get_serializer_class()

    @transaction.atomic
    def perform_create(self, serializer):
        self.lock_membership()
        serializer.save(workspace_id=self.request.workspace_id, created_by=self.request.user)


class ClientInUse(APIException):
    status_code = 409
    default_detail = "This client has related records and cannot be deleted. Remove or resolve those records first."


class ClientDetail(ClientQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    def get_serializer_class(self):
        if self.request.method == "GET":
            return ClientDetailSerializer
        return super().get_serializer_class()

    @transaction.atomic
    def perform_update(self, serializer):
        self.lock_membership()
        serializer.save()

    @transaction.atomic
    def perform_destroy(self, instance):
        self.lock_membership()
        instance = get_object_or_404(self.get_queryset().select_for_update(), pk=instance.pk)
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ClientInUse() from exc


class ClientHistoryList(ClientQuerysetMixin, generics.ListCreateAPIView):
    pagination_class = ClientPagination

    def get_client(self, lock=False):
        queryset = super().get_queryset()
        if lock:
            queryset = queryset.select_for_update()
        client = get_object_or_404(queryset, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, client)
        return client

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.client = self.get_client()

    def get_queryset(self):
        queryset = getattr(self.client, self.relation).order_by("created_at", "id")
        return queryset.select_related("author") if self.relation == "notes" else queryset

    @transaction.atomic
    def perform_create(self, serializer):
        self.lock_membership()
        values = {"client": self.get_client(lock=True)}
        if self.relation == "notes":
            values["author"] = self.request.user
        serializer.save(**values)


class ClientNotes(ClientHistoryList):
    relation = "notes"
    serializer_class = ClientNoteSerializer


class ClientLinks(ClientHistoryList):
    relation = "links"
    serializer_class = ClientLinkSerializer


class ClientNoteDetail(ClientQuerysetMixin, generics.DestroyAPIView):
    serializer_class = ClientNoteSerializer

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        self.lock_membership()
        client = get_object_or_404(self.get_queryset().select_for_update(), pk=kwargs["pk"])
        self.check_object_permissions(request, client)
        note = get_object_or_404(client.notes.select_for_update(), pk=kwargs["note_id"])
        if note.author_id != request.user.pk:
            raise PermissionDenied("Only the author can delete this note.")
        note.delete()
        return Response(status=204)


class DealConflict(APIException):
    status_code = 409
    default_detail = "This record was updated elsewhere. Reload to see the latest version."


class DealQuerysetMixin(WorkspaceQuerysetMixin):
    queryset = Deal.objects.order_by("-created_at", "-id")
    serializer_class = DealSerializer
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get_queryset(self):
        return super().get_queryset().filter(client__workspace_id=self.request.workspace_id)

    def lock_membership(self):
        membership = WorkspaceMembership.objects.select_for_update().filter(user=self.request.user, workspace_id=self.request.workspace_id).first()
        if membership is None:
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")

    def lock_client(self, client):
        return get_object_or_404(Client.objects.select_for_update(), pk=client.pk, workspace_id=self.request.workspace_id)


class DealList(DealQuerysetMixin, generics.ListCreateAPIView):
    pagination_class = ClientPagination
    filter_backends = [filters.SearchFilter]
    search_fields = ["title", "client__name", "client__company"]

    def filter_queryset(self, queryset):
        params = DealFilters(data=self.request.query_params)
        params.is_valid(raise_exception=True)
        return super().filter_queryset(queryset.filter(**params.validated_data))

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        totals = list(queryset.order_by().values("status", "currency").annotate(count=Count("id"), amount=Sum("amount")).order_by("status", "currency"))
        for row in totals:
            row["amount"] = format(row["amount"], ".2f")
        page = self.paginate_queryset(queryset)
        response = self.get_paginated_response(self.get_serializer(page, many=True).data)
        response.data["totals"] = totals
        return response

    @transaction.atomic
    def perform_create(self, serializer):
        self.lock_membership()
        client = self.lock_client(serializer.validated_data["client"])
        status = serializer.validated_data.get("status", Deal.Status.NEW_LEAD)
        serializer.save(workspace_id=self.request.workspace_id, created_by=self.request.user, client=client, paid_at=timezone.now() if status == Deal.Status.PAID else None)


class DealDetail(DealQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    @transaction.atomic
    def update(self, request, *args, **kwargs):
        self.lock_membership()
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        version = values.pop("version")
        if version != instance.version:
            raise DealConflict()
        if "client" in values:
            values["client"] = self.lock_client(values["client"])
        status = values.get("status", instance.status)
        now = timezone.now()
        values["paid_at"] = (instance.paid_at if instance.status == Deal.Status.PAID else now) if status == Deal.Status.PAID else None
        values["updated_at"] = now
        values["version"] = F("version") + 1
        changed = Deal.objects.filter(pk=instance.pk, workspace_id=request.workspace_id, version=version, version__lt=2147483647).update(**values)
        if not changed:
            raise DealConflict()
        instance.refresh_from_db()
        return Response(DealSerializer(instance, context=self.get_serializer_context()).data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        self.lock_membership()
        instance = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=kwargs["pk"])
        self.check_object_permissions(request, instance)
        serializer = DealDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data["version"] != instance.version:
            raise DealConflict()
        try:
            instance.delete()
        except ProtectedError as exc:
            raise DealConflict("This deal has related records and cannot be deleted.") from exc
        return Response(status=204)


class DealStatus(DealDetail):
    http_method_names = ["patch", "options"]
    serializer_class = DealStatusSerializer


def buyer_snapshot(client):
    return {"name": client.name, "company": client.company, "email": client.email, "phone": client.phone}


def invoice_number(workspace_id):
    numbers = Invoice.objects.filter(workspace_id=workspace_id).values_list("invoice_number", flat=True)
    sequence = max((int(match.group(1)) for number in numbers if (match := re.fullmatch(r"INV-(\d+)", number))), default=0)
    return f"INV-{sequence + 1:06d}"


class InvoiceQuerysetMixin(WorkspaceQuerysetMixin):
    queryset = Invoice.objects.order_by("-created_at", "-id")
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get_queryset(self):
        return super().get_queryset().filter(client__workspace_id=self.request.workspace_id).select_related("client").prefetch_related("items")

    def lock_membership(self):
        membership = WorkspaceMembership.objects.select_for_update().filter(user=self.request.user, workspace_id=self.request.workspace_id).first()
        if membership is None:
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")

    def lock_client(self, client):
        return get_object_or_404(Client.objects.select_for_update(), pk=client.pk, workspace_id=self.request.workspace_id)

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
        if status_filter and status_filter not in Invoice.Status.values:
            raise ValidationError({"status": "Unknown invoice status."})
        if currency and currency not in CURRENCY_PLACES:
            raise ValidationError({"currency": "Unsupported invoice currency."})
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if currency:
            queryset = queryset.filter(currency=currency)
        return super().filter_queryset(queryset)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        self.lock_membership()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        workspace = Workspace.objects.select_for_update().get(pk=request.workspace_id)
        client = self.lock_client(values["client"])
        calculated, subtotal, tax_total, total_amount = self.calculated_items(values["items"], values["currency"])
        seller = values.get("seller", {"name": workspace.name, "email": request.user.email})
        invoice = Invoice.objects.create(
            workspace=workspace, created_by=request.user, client=client,
            invoice_number=invoice_number(workspace.pk), currency=values["currency"],
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
        currency = values.get("currency", invoice.currency)
        items = values.get("items")
        if items is None:
            items = [dict(description=item.description, quantity=item.quantity, unit_price=item.unit_price, tax_rate=item.tax_rate) for item in invoice.items.all()]
        calculated, subtotal, tax_total, total_amount = self.calculated_items(items, currency)
        invoice.client = client
        invoice.currency = currency
        invoice.subtotal = subtotal
        invoice.tax_total = tax_total
        invoice.total_amount = total_amount
        if "client" in values:
            invoice.buyer_snapshot = buyer_snapshot(client)
        if "seller" in values:
            invoice.seller_snapshot = values["seller"]
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
            invoice.status = Invoice.Status.SENT
            invoice.issued_at = timezone.now()
        elif invoice.status == Invoice.Status.SENT and target == Invoice.Status.PAID:
            invoice.status = Invoice.Status.PAID
            invoice.paid_at = timezone.now()
        else:
            raise ValidationError({"status": "This invoice status transition is not allowed."})
        invoice.save()
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


def month_offset(year, month, offset):
    index = year * 12 + month - 1 + offset
    return index // 12, index % 12 + 1


class Dashboard(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request):
        filters = DashboardFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        currency = filters.validated_data["currency"]
        period = filters.validated_data["period"]
        now = timezone.localtime()
        zone = timezone.get_current_timezone()
        if period == "month":
            start_year, start_month = month_offset(now.year, now.month, -11)
            end_year, end_month = month_offset(now.year, now.month, 1)
            labels = [month_offset(start_year, start_month, index) for index in range(12)]
            truncation = TruncMonth("paid_at", tzinfo=zone)
        else:
            current_quarter = (now.month - 1) // 3
            start_year, start_month = month_offset(now.year, current_quarter * 3 + 1, -21)
            end_year, end_month = month_offset(now.year, current_quarter * 3 + 1, 3)
            labels = [month_offset(start_year, start_month, index * 3) for index in range(8)]
            truncation = TruncQuarter("paid_at", tzinfo=zone)
        start = timezone.make_aware(datetime(start_year, start_month, 1), zone)
        end = timezone.make_aware(datetime(end_year, end_month, 1), zone)

        deals = Deal.objects.filter(workspace_id=request.workspace_id, client__workspace_id=request.workspace_id, currency=currency)
        active = deals.filter(status__in=[Deal.Status.NEW_LEAD, Deal.Status.NEGOTIATION, Deal.Status.IN_PROGRESS])
        pipeline = active.aggregate(amount=Sum("amount"))["amount"] or Decimal("0")
        paid_deals = deals.filter(status=Deal.Status.PAID)
        paid = paid_deals.aggregate(count=Count("id"), amount=Sum("amount"))
        lost_count = deals.filter(status=Deal.Status.ARCHIVED, outcome=Deal.Outcome.LOST).count()
        denominator = paid["count"] + lost_count
        win_rate = (Decimal(paid["count"]) * 100 / denominator).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if denominator else None
        average = ((paid["amount"] or Decimal("0")) / paid["count"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if paid["count"] else None

        invoices = Invoice.objects.filter(workspace_id=request.workspace_id, currency=currency, status=Invoice.Status.PAID, paid_at__gte=start, paid_at__lt=end)
        grouped = invoices.annotate(bucket=truncation).values("bucket").annotate(amount=Sum("total_amount")).order_by("bucket")
        amounts = {(row["bucket"].year, row["bucket"].month): row["amount"] for row in grouped}
        rows = [{"period": f"{year:04d}-{month:02d}", "revenue": money_string(amounts.get((year, month), Decimal("0")), currency)} for year, month in labels]
        revenue = sum(amounts.values(), Decimal("0"))
        stages = list(deals.values("status").annotate(count=Count("id")).order_by("status"))
        recent = list(active.select_related("client").order_by("deadline", "id")[:4].values("id", "title", "client__name", "client__company", "status", "deadline", "amount"))
        for deal in recent:
            deal["amount"] = f"{deal['amount']:.2f}"
        return Response({
            "currency": currency,
            "period": period,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "pipeline_value": f"{pipeline:.2f}",
            "win_rate": f"{win_rate:.2f}" if win_rate is not None else None,
            "average_deal_size": f"{average:.2f}" if average is not None else None,
            "revenue": money_string(revenue, currency),
            "revenue_rows": rows,
            "deal_counts": stages,
            "recent_deals": recent,
        })


@require_GET
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        return JsonResponse({"status": "unavailable", "database": "unavailable"}, status=503)
    return JsonResponse({"status": "ok", "database": "ok"})
