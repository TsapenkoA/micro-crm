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
            if entity_type not in {"client", "deal", "task", "invoice"}:
                raise ValidationError({"entity_type": "Choose client, deal, task or invoice."})
            queryset = queryset.filter(entity_type=entity_type)
        return queryset
