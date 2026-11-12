from django.db import transaction
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from crm.api.permissions import IsWorkspaceMember
from crm.auth.security import AuthThrottle, recent_auth
from crm.models import Client, Deal, Invoice, PreviewDataset, Workspace, WorkspaceMembership
from crm.workspaces.serializers import BankDetailsSerializer, SellerDetailsSerializer, WorkspaceNameSerializer


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


class WorkspaceBankDetails(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request):
        workspace = get_object_or_404(Workspace, pk=request.workspace_id)
        if workspace.owner_id != request.user.pk:
            raise PermissionDenied("Only the workspace owner can access payment details.")
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity in Security before viewing payment details.")
        response = Response(BankDetailsSerializer(workspace.bank_details).data)
        response["Cache-Control"] = "no-store"
        return response

    @transaction.atomic
    def put(self, request):
        if not WorkspaceMembership.objects.select_for_update().filter(user=request.user, workspace_id=request.workspace_id).exists():
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")
        workspace = Workspace.objects.select_for_update().get(pk=request.workspace_id)
        if workspace.owner_id != request.user.pk:
            raise PermissionDenied("Only the workspace owner can access payment details.")
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity in Security before changing payment details.")
        serializer = BankDetailsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        workspace.bank_details = serializer.validated_data
        workspace.save(update_fields=["bank_details", "updated_at"])
        response = Response(BankDetailsSerializer(workspace.bank_details).data)
        response["Cache-Control"] = "no-store"
        return response


class WorkspaceSellerDetails(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request):
        workspace = get_object_or_404(Workspace, pk=request.workspace_id)
        if workspace.owner_id != request.user.pk:
            raise PermissionDenied("Only the workspace owner can access seller details.")
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity in Security before viewing seller details.")
        response = Response(workspace.seller_details)
        response["Cache-Control"] = "no-store"
        return response

    @transaction.atomic
    def put(self, request):
        if not WorkspaceMembership.objects.select_for_update().filter(user=request.user, workspace_id=request.workspace_id).exists():
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")
        workspace = Workspace.objects.select_for_update().get(pk=request.workspace_id)
        if workspace.owner_id != request.user.pk:
            raise PermissionDenied("Only the workspace owner can access seller details.")
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity in Security before changing seller details.")
        serializer = SellerDetailsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        workspace.seller_details = serializer.validated_data
        workspace.save(update_fields=["seller_details", "updated_at"])
        response = Response(SellerDetailsSerializer(workspace.seller_details).data)
        response["Cache-Control"] = "no-store"
        return response


class WorkspaceSettings(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request):
        workspace = get_object_or_404(Workspace, pk=request.workspace_id)
        members = WorkspaceMembership.objects.filter(workspace=workspace).select_related("user").order_by("user__username", "user_id")
        return Response({
            "id": str(workspace.pk),
            "name": workspace.name,
            "can_manage_members": workspace.owner_id == request.user.pk,
            "members": [member_data(member.user) for member in members],
        })

    @transaction.atomic
    def patch(self, request):
        if not isinstance(request.data, dict) or set(request.data) != {"name"}:
            raise ValidationError({"name": "Only name can be changed here."})
        serializer = WorkspaceNameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not WorkspaceMembership.objects.select_for_update().filter(user=request.user, workspace_id=request.workspace_id).exists():
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")
        workspace = Workspace.objects.select_for_update().get(pk=request.workspace_id)
        workspace.name = serializer.validated_data["name"]
        workspace.save(update_fields=["name", "updated_at"])
        return Response({"id": str(workspace.pk), "name": workspace.name})


class MembershipConflict(APIException):
    status_code = 409
    default_detail = "This account cannot be added to the workspace. Ask the account holder to use an empty personal workspace."


def member_data(user):
    return {"id": user.pk, "username": user.username, "name": user.get_full_name().strip(), "email": user.email}


class WorkspaceMembers(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]
    throttle_classes = [AuthThrottle]
    rate_scope = "security"

    @transaction.atomic
    def post(self, request):
        if not isinstance(request.data, dict) or set(request.data) != {"username"}:
            raise ValidationError({"username": "Provide only the existing account's username."})
        username = request.data["username"]
        if not isinstance(username, str) or not username.strip() or len(username.strip()) > 150:
            raise ValidationError({"username": "Enter a valid username."})
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity in Security before adding a member.")
        workspace = Workspace.objects.select_for_update().get(pk=request.workspace_id)
        if workspace.owner_id != request.user.pk:
            raise PermissionDenied("Only the workspace owner can add members.")
        user = get_user_model().objects.select_for_update().filter(username__iexact=username.strip(), is_active=True).first()
        if user is None:
            raise MembershipConflict()
        membership = WorkspaceMembership.objects.select_for_update().filter(user=user).first()
        if membership is None:
            raise MembershipConflict()
        if membership.workspace_id == workspace.pk:
            return Response({"member": member_data(user)})
        source = Workspace.objects.select_for_update().get(pk=membership.workspace_id)
        if (source.owner_id != user.pk or source.memberships.count() != 1
                or source.clients.exists() or source.deals.exists() or source.invoices.exists()):
            raise MembershipConflict()
        membership.workspace = workspace
        membership.save(update_fields=["workspace"])
        source.owner = None
        source.save(update_fields=["owner", "updated_at"])
        return Response({"member": member_data(user)}, status=201)


class WorkspaceMemberDetail(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]
    throttle_classes = [AuthThrottle]
    rate_scope = "security"

    @transaction.atomic
    def delete(self, request, user_id):
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity in Security before removing a member.")
        workspace = Workspace.objects.select_for_update().get(pk=request.workspace_id)
        if workspace.owner_id != request.user.pk:
            raise PermissionDenied("Only the workspace owner can remove members.")
        if user_id == request.user.pk:
            raise PermissionDenied("The workspace owner cannot remove themselves.")
        membership = get_object_or_404(
            WorkspaceMembership.objects.select_for_update(), user_id=user_id, workspace_id=workspace.pk,
        )
        employee = get_user_model().objects.select_for_update().get(pk=user_id)
        personal = Workspace.objects.create(name=f"{employee.username}'s workspace", owner=employee)
        currency = membership.reporting_currency
        membership.delete()
        WorkspaceMembership.objects.create(user=employee, workspace=personal, reporting_currency=currency)
        for session in Session.objects.filter(expire_date__gt=timezone.now()).iterator():
            if str(session.get_decoded().get("_auth_user_id")) == str(user_id):
                session.delete()
        return Response(status=204)
