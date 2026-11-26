import os

from django.db import transaction
from django.db.models import Count, Q
from django.db.models.deletion import ProtectedError
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.http import content_disposition_header
from rest_framework import filters, generics
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from crm.activity.services import log_activity, snapshot
from crm.api.pagination import ClientPagination
from crm.api.permissions import IsWorkspaceMember, WorkspaceQuerysetMixin
from crm.api.serializers import StrictModelSerializer
from crm.clients.serializers import (
    ClientContactSerializer,
    ClientDetailSerializer,
    ClientInvoiceSerializer,
    ClientLinkSerializer,
    ClientListSerializer,
    ClientNoteSerializer,
    ClientSerializer,
)
from crm.models import Client, ClientAttachment, Invoice, WorkspaceMembership
from crm.services.uploads import scan_upload


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
        client = serializer.save(workspace_id=self.request.workspace_id, created_by=self.request.user)
        log_activity(client, self.request.user, "created")


class ClientInUse(APIException):
    status_code = 409
    default_code = "protected"
    default_detail = "This client has related records and cannot be deleted. Remove or resolve those records first."


class ClientDetail(ClientQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    def get_serializer_class(self):
        if self.request.method == "GET":
            return ClientDetailSerializer
        return super().get_serializer_class()

    @transaction.atomic
    def perform_update(self, serializer):
        self.lock_membership()
        before = snapshot(serializer.instance)
        bank_before = serializer.instance.bank_details.copy()
        client = serializer.save()
        log_activity(client, self.request.user, "updated", before)
        if bank_before != client.bank_details:
            log_activity(client, self.request.user, "payer_bank_updated")

    @transaction.atomic
    def perform_destroy(self, instance):
        self.lock_membership()
        instance = get_object_or_404(self.get_queryset().select_for_update(), pk=instance.pk)
        try:
            log_activity(instance, self.request.user, "deleted")
            instance.attachments.all().delete()
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
        record = serializer.save(**values)
        log_activity(values["client"], self.request.user, "note_added" if self.relation == "notes" else "link_added",
                     details={"link": record.label} if self.relation == "links" else None)


class ClientNotes(ClientHistoryList):
    relation = "notes"
    serializer_class = ClientNoteSerializer


class ClientInvoices(ClientQuerysetMixin, generics.ListAPIView):
    serializer_class = ClientInvoiceSerializer
    pagination_class = ClientPagination

    def get_queryset(self):
        client = get_object_or_404(super().get_queryset(), pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, client)
        return Invoice.objects.filter(workspace_id=self.request.workspace_id, client=client).order_by("-created_at", "-id")


class ClientLinks(ClientHistoryList):
    relation = "links"
    serializer_class = ClientLinkSerializer


class ClientLinkDetail(ClientQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ClientLinkSerializer
    http_method_names = ["get", "patch", "delete", "options"]

    def get_queryset(self):
        client = get_object_or_404(super().get_queryset(), pk=self.kwargs["pk"])
        return client.links.all()

    def get_object(self):
        return get_object_or_404(self.get_queryset(), pk=self.kwargs["link_id"])

    @transaction.atomic
    def perform_update(self, serializer):
        self.lock_membership()
        serializer.save()
        log_activity(serializer.instance.client, self.request.user, "link_updated", details={"link": serializer.instance.label})

    @transaction.atomic
    def perform_destroy(self, instance):
        self.lock_membership()
        log_activity(instance.client, self.request.user, "link_deleted", details={"link": instance.label})
        instance.delete()


class ClientContacts(ClientQuerysetMixin, generics.ListCreateAPIView):
    serializer_class = ClientContactSerializer

    def get_client(self, lock=False):
        queryset = super().get_queryset()
        if lock:
            queryset = queryset.select_for_update()
        return get_object_or_404(queryset, pk=self.kwargs["pk"])

    def get_queryset(self):
        return self.get_client().contacts.order_by("-is_primary", "created_at", "id")

    @transaction.atomic
    def perform_create(self, serializer):
        self.lock_membership()
        client = self.get_client(lock=True)
        if serializer.validated_data.get("is_primary"):
            client.contacts.filter(is_primary=True).update(is_primary=False)
        contact = serializer.save(client=client)
        log_activity(client, self.request.user, "contact_added", details={"contact": contact.name})
        if contact.is_primary:
            client.name, client.email, client.phone = contact.name, contact.email, contact.phone
            client.save(update_fields=["name", "email", "phone", "updated_at"])


class PrimaryContactInUse(APIException):
    status_code = 409
    default_detail = "Choose another primary contact before deleting this one."


class ClientContactDetail(ClientQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ClientContactSerializer
    http_method_names = ["get", "patch", "delete", "options"]

    def get_client(self):
        return get_object_or_404(super().get_queryset().select_for_update(), pk=self.kwargs["pk"])

    def get_object(self):
        client = get_object_or_404(super().get_queryset(), pk=self.kwargs["pk"])
        return get_object_or_404(client.contacts, pk=self.kwargs["contact_id"])

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        self.lock_membership()
        client = self.get_client()
        contact = get_object_or_404(client.contacts.select_for_update(), pk=kwargs["contact_id"])
        serializer = self.get_serializer(contact, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        primary = serializer.validated_data.get("is_primary", contact.is_primary)
        if contact.is_primary and not primary:
            raise PrimaryContactInUse("Choose another primary contact first.")
        if primary and not contact.is_primary:
            client.contacts.filter(is_primary=True).update(is_primary=False)
        contact = serializer.save()
        log_activity(client, request.user, "contact_updated", details={"contact": contact.name})
        if contact.is_primary:
            client.name, client.email, client.phone = contact.name, contact.email, contact.phone
            client.save(update_fields=["name", "email", "phone", "updated_at"])
        return Response(self.get_serializer(contact).data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        self.lock_membership()
        client = self.get_client()
        contact = get_object_or_404(client.contacts.select_for_update(), pk=kwargs["contact_id"])
        if contact.is_primary:
            raise PrimaryContactInUse()
        log_activity(client, request.user, "contact_deleted", details={"contact": contact.name})
        contact.delete()
        return Response(status=204)


class ClientAttachmentSerializer(StrictModelSerializer):
    class Meta:
        model = ClientAttachment
        fields = ["id", "client", "name", "content_type", "size", "uploaded_by", "created_at"]
        read_only_fields = fields


def attachment_type(name, content):
    extension = os.path.splitext(name)[1].lower()
    signatures = {
        ".pdf": (b"%PDF-", "application/pdf"),
        ".png": (b"\x89PNG\r\n\x1a\n", "image/png"),
        ".jpg": (b"\xff\xd8\xff", "image/jpeg"),
        ".jpeg": (b"\xff\xd8\xff", "image/jpeg"),
        ".webp": (b"RIFF", "image/webp"),
    }
    if extension not in signatures:
        raise ValidationError({"file": "Upload a PDF, PNG, JPEG or WebP file."})
    signature, mime = signatures[extension]
    if not content.startswith(signature) or extension == ".webp" and content[8:12] != b"WEBP":
        raise ValidationError({"file": "The file contents do not match its extension."})
    return mime


class ClientAttachments(ClientQuerysetMixin, generics.ListCreateAPIView):
    serializer_class = ClientAttachmentSerializer
    parser_classes = [MultiPartParser]
    pagination_class = ClientPagination

    def get_client(self, lock=False):
        queryset = super().get_queryset()
        if lock:
            queryset = queryset.select_for_update()
        return get_object_or_404(queryset, pk=self.kwargs["pk"])

    def get_queryset(self):
        return self.get_client().attachments.defer("content").order_by("-created_at", "-id")

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        self.lock_membership()
        client = self.get_client(lock=True)
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Choose a file."})
        if upload.size > 5 * 1024 * 1024 or upload.size == 0:
            raise ValidationError({"file": "Choose a file between 1 byte and 5 MB."})
        if client.attachments.count() >= 50:
            raise ValidationError({"file": "This client has reached the 50-file limit."})
        name = os.path.basename(upload.name.replace("\\", "/"))
        if not name or len(name) > 200:
            raise ValidationError({"file": "The filename must be 1–200 characters."})
        content = upload.read(5 * 1024 * 1024 + 1)
        if len(content) != upload.size:
            raise ValidationError({"file": "The upload could not be read."})
        mime = attachment_type(name, content)
        scan_upload(content)
        attachment = ClientAttachment.objects.create(
            client=client, uploaded_by=request.user, name=name,
            content_type=mime, size=len(content), content=content,
        )
        log_activity(client, request.user, "attachment_added", details={"file": attachment.name})
        return Response(self.get_serializer(attachment).data, status=201)


class ClientAttachmentDetail(ClientQuerysetMixin, generics.GenericAPIView):
    def get_attachment(self, lock=False):
        client = get_object_or_404(super().get_queryset(), pk=self.kwargs["pk"])
        queryset = client.attachments
        if lock:
            queryset = queryset.defer("content").select_for_update()
        return get_object_or_404(queryset, pk=self.kwargs["attachment_id"])

    def get(self, request, *args, **kwargs):
        attachment = self.get_attachment()
        scan_upload(bytes(attachment.content))
        response = HttpResponse(bytes(attachment.content), content_type=attachment.content_type)
        response["Content-Disposition"] = content_disposition_header(True, attachment.name)
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @transaction.atomic
    def delete(self, request, *args, **kwargs):
        self.lock_membership()
        attachment = self.get_attachment(lock=True)
        log_activity(attachment.client, request.user, "attachment_deleted", details={"file": attachment.name})
        attachment.delete()
        return Response(status=204)


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
        log_activity(client, request.user, "note_deleted")
        note.delete()
        return Response(status=204)
