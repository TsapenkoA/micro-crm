from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from crm.api.permissions import IsWorkspaceMember
from crm.models import Client, Deal, Invoice, PreviewDataset, Workspace, WorkspaceMembership
from crm.workspaces.serializers import BankDetailsSerializer


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
        return Response(BankDetailsSerializer(workspace.bank_details).data)

    @transaction.atomic
    def put(self, request):
        if not WorkspaceMembership.objects.select_for_update().filter(user=request.user, workspace_id=request.workspace_id).exists():
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")
        serializer = BankDetailsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        workspace = Workspace.objects.select_for_update().get(pk=request.workspace_id)
        workspace.bank_details = serializer.validated_data
        workspace.save(update_fields=["bank_details", "updated_at"])
        return Response(BankDetailsSerializer(workspace.bank_details).data)
