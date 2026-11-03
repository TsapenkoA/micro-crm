from django.db import transaction
from django.db.models.deletion import ProtectedError
from rest_framework import filters, generics
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated

from common.permissions import IsWorkspaceMember, WorkspaceQuerysetMixin
from apps.accounts.models import WorkspaceMembership
from .models import Client
from .serializers import ClientDetailSerializer, ClientSerializer


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
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ClientInUse() from exc
