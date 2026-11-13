from django.db import transaction
from django.db.models import Count, F, Sum
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import filters, generics, status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from crm.api.pagination import ClientPagination
from crm.api.permissions import IsWorkspaceMember, WorkspaceQuerysetMixin
from crm.activity.services import log_activity, snapshot
from crm.deals.serializers import DealDeleteSerializer, DealFilters, DealSerializer, DealStatusSerializer
from crm.models import Client, Deal, WorkspaceMembership
from crm.services.fx import rate_date_for


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
        paid_at = timezone.now() if status == Deal.Status.PAID else None
        rate_date = rate_date_for(serializer.validated_data["currency"], timezone.localtime(paid_at).date()) if paid_at else None
        deal = serializer.save(workspace_id=self.request.workspace_id, created_by=self.request.user, client=client, paid_at=paid_at, fx_rate_date=rate_date)
        log_activity(deal, self.request.user, "created")


class DealDetail(DealQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    @transaction.atomic
    def update(self, request, *args, **kwargs):
        self.lock_membership()
        instance = self.get_object()
        before = snapshot(instance)
        serializer = self.get_serializer(instance, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        version = values.pop("version")
        if version != instance.version:
            raise DealConflict()
        if "client" in values:
            values["client"] = self.lock_client(values["client"])
            if values["client"].pk != instance.client_id and instance.invoices.exists():
                raise ValidationError({"client": "Remove linked invoices before changing this deal's client."})
        status = values.get("status", instance.status)
        now = timezone.now()
        values["paid_at"] = (instance.paid_at if instance.status == Deal.Status.PAID else now) if status == Deal.Status.PAID else None
        if values["paid_at"]:
            same_currency = values.get("currency", instance.currency) == instance.currency
            values["fx_rate_date"] = instance.fx_rate_date if same_currency else None
            if values["fx_rate_date"] is None:
                values["fx_rate_date"] = rate_date_for(values.get("currency", instance.currency), timezone.localtime(values["paid_at"]).date())
        else:
            values["fx_rate_date"] = None
        values["updated_at"] = now
        values["version"] = F("version") + 1
        changed = Deal.objects.filter(pk=instance.pk, workspace_id=request.workspace_id, version=version, version__lt=2147483647).update(**values)
        if not changed:
            raise DealConflict()
        if "client" in values and values["client"].pk != instance.client_id and instance.invoices.exists():
            raise ValidationError({"client": "Remove linked invoices before changing this deal's client."})
        instance.refresh_from_db()
        log_activity(instance, request.user, "updated", before)
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
            log_activity(instance, request.user, "deleted")
            instance.delete()
        except ProtectedError as exc:
            raise DealConflict("This deal has related records and cannot be deleted.") from exc
        return Response(status=204)


class DealStatus(DealDetail):
    http_method_names = ["patch", "options"]
    serializer_class = DealStatusSerializer
