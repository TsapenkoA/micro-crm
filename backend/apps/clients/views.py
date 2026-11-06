from django.db import transaction
from django.db.models import Count, Q
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import filters, generics
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from common.permissions import IsWorkspaceMember, WorkspaceQuerysetMixin
from apps.accounts.models import WorkspaceMembership
from .models import Client
from .serializers import ClientDetailSerializer, ClientLinkSerializer, ClientListSerializer, ClientNoteSerializer, ClientSerializer


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
