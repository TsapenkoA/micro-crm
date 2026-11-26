from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from crm.api.pagination import ClientPagination
from crm.invoices.delivery_resolution import resolve_invoice_delivery
from crm.invoices.serializers import (
    InvoiceDeliveryResolutionInputSerializer,
    InvoiceDeliveryResolutionOutputSerializer,
)
from crm.models import InvoiceDelivery


def require_platform_admin(user):
    if not user.is_superuser:
        raise PermissionDenied("Only platform administrators can resolve invoice email attempts.")


class InvoiceDeliveryResolutionList(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_platform_admin(request.user)
        attempts = InvoiceDelivery.objects.filter(
            result__in=[InvoiceDelivery.Result.PENDING, InvoiceDelivery.Result.UNKNOWN],
            resolved_at__isnull=True,
        ).select_related("invoice__workspace")
        paginator = ClientPagination()
        page = paginator.paginate_queryset(attempts, request, view=self)
        data = InvoiceDeliveryResolutionOutputSerializer(page, many=True).data
        response = paginator.get_paginated_response(data)
        response["Cache-Control"] = "no-store"
        return response


class InvoiceDeliveryResolutionDetail(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        require_platform_admin(request.user)
        serializer = InvoiceDeliveryResolutionInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            delivery = resolve_invoice_delivery(
                pk,
                serializer.validated_data["outcome"],
                request.user,
                serializer.validated_data["reason"],
            )
        except ValueError as error:
            raise ValidationError({"detail": str(error)}) from error
        response = Response(InvoiceDeliveryResolutionOutputSerializer(delivery).data)
        response["Cache-Control"] = "no-store"
        return response
