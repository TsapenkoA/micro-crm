from rest_framework import generics, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated

from crm.api.pagination import ClientPagination
from crm.api.permissions import IsWorkspaceMember, WorkspaceQuerysetMixin
from crm.models import ActivityEvent


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityEvent
        fields = ("id", "actor_name", "entity_type", "entity_id", "entity_label", "action", "changes", "created_at")


class ActivityList(WorkspaceQuerysetMixin, generics.ListAPIView):
    queryset = ActivityEvent.objects.order_by("-created_at", "-id")
    serializer_class = ActivitySerializer
    pagination_class = ClientPagination
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get_queryset(self):
        queryset = super().get_queryset()
        entity_type = self.request.query_params.get("entity_type")
        if entity_type is not None:
            if entity_type not in {"client", "deal", "task", "invoice", "workspace"}:
                raise ValidationError({"entity_type": "Choose client, deal, task, invoice or workspace."})
            queryset = queryset.filter(entity_type=entity_type)
        entity_id = self.request.query_params.get("entity_id")
        if entity_id:
            queryset = queryset.filter(entity_id=serializers.UUIDField().run_validation(entity_id))
        actor = self.request.query_params.get("actor", "").strip()
        if len(actor) > 150:
            raise ValidationError({"actor": "Author search is too long."})
        if actor:
            queryset = queryset.filter(actor_name__icontains=actor)
        dates = {}
        for name in ("date_from", "date_to"):
            value = self.request.query_params.get(name)
            if value:
                dates[name] = serializers.DateField().run_validation(value)
        if dates.get("date_from") and dates.get("date_to") and dates["date_from"] > dates["date_to"]:
            raise ValidationError({"date_to": "End date must be on or after start date."})
        if dates.get("date_from"):
            queryset = queryset.filter(created_at__date__gte=dates["date_from"])
        if dates.get("date_to"):
            queryset = queryset.filter(created_at__date__lte=dates["date_to"])
        return queryset
