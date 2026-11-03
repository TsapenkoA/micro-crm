from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from apps.accounts.models import WorkspaceMembership


def user_workspace_id(user):
    workspace_id = WorkspaceMembership.objects.filter(user=user).values_list("workspace_id", flat=True).first()
    if workspace_id is None:
        raise PermissionDenied("No workspace is assigned to this account.")
    return workspace_id


class IsWorkspaceMember(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        request.workspace_id = user_workspace_id(request.user)
        return True

    def has_object_permission(self, request, view, obj):
        return obj.workspace_id == request.workspace_id


class WorkspaceQuerysetMixin:
    def get_queryset(self):
        return super().get_queryset().filter(workspace_id=self.request.workspace_id)
