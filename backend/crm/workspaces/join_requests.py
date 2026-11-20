from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from crm.activity.services import log_workspace_member
from crm.api.permissions import IsWorkspaceMember
from crm.auth.security import AuthThrottle, recent_auth
from crm.models import Workspace, WorkspaceJoinRequest, WorkspaceMembership


class WorkspaceJoinDecision(APIView):
    permission_classes = [IsWorkspaceMember]
    throttle_classes = [AuthThrottle]
    rate_scope = "security"

    @transaction.atomic
    def post(self, request, pk):
        if not isinstance(request.data, dict) or set(request.data) != {"decision"} or request.data["decision"] not in ("accept", "decline"):
            raise ValidationError({"decision": "Choose accept or decline."})
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity in Security before responding.")
        invitation = get_object_or_404(
            WorkspaceJoinRequest.objects.select_for_update(), pk=pk, user=request.user,
            expires_at__gt=timezone.now(),
        )
        if request.data["decision"] == "decline":
            invitation.delete()
            return Response(status=204)
        membership = WorkspaceMembership.objects.select_for_update().get(user=request.user)
        workspaces = {item.pk: item for item in Workspace.objects.select_for_update().filter(
            pk__in=[membership.workspace_id, invitation.workspace_id],
        ).order_by("pk")}
        source, target = workspaces[membership.workspace_id], workspaces[invitation.workspace_id]
        if target.owner_id != invitation.requested_by_id:
            raise PermissionDenied("This request is no longer valid.")
        if source.pk == target.pk:
            invitation.delete()
            return Response(status=204)
        if (source.owner_id != request.user.pk or source.memberships.count() != 1
                or source.clients.exists() or source.deals.exists() or source.invoices.exists()
                or source.bank_details or source.seller_details or hasattr(source, "preview_dataset")):
            raise ValidationError("Only an empty personal workspace can join another company. Your existing data has not been changed.")
        membership.workspace = target
        membership.save(update_fields=["workspace"])
        source.owner = None
        source.save(update_fields=["owner", "updated_at"])
        log_workspace_member(target, invitation.requested_by, "member_added", request.user)
        WorkspaceJoinRequest.objects.filter(user=request.user).delete()
        request.session.pop("auth_time", None)
        request.session.pop("reauth_user", None)
        return Response({"workspace": {"id": str(target.pk), "name": target.name}})
