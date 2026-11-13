from django.contrib.auth import get_user_model
from rest_framework import serializers

from crm.models import Client, Deal, Task, WorkspaceMembership


class TaskSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    deal_title = serializers.CharField(source="deal.title", read_only=True)
    assignee_name = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = ["id", "client", "client_name", "deal", "deal_title", "title", "assignee", "assignee_name",
                  "due_at", "status", "completed_at", "created_by", "created_at", "updated_at"]
        read_only_fields = ["id", "client_name", "deal_title", "assignee_name", "completed_at", "created_by", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        workspace_id = self.context["request"].workspace_id
        self.fields["client"].queryset = Client.objects.filter(workspace_id=workspace_id)
        self.fields["deal"].queryset = Deal.objects.filter(workspace_id=workspace_id, client__workspace_id=workspace_id)
        self.fields["assignee"].queryset = get_user_model().objects.filter(workspace_membership__workspace_id=workspace_id, is_active=True)

    def get_assignee_name(self, instance):
        return (instance.assignee.get_full_name().strip() or instance.assignee.username) if instance.assignee else None

    def validate_title(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter a task title.")
        return value.strip()

    def validate(self, attrs):
        if "assignee" in attrs and attrs["assignee"] is None:
            raise serializers.ValidationError({"assignee": "Choose a workspace member."})
        client = attrs.get("client", getattr(self.instance, "client", None))
        deal = attrs.get("deal", getattr(self.instance, "deal", None))
        if deal and client and deal.client_id != client.pk:
            raise serializers.ValidationError({"deal": "Choose a deal for this client."})
        if self.instance and ("client" in attrs or "deal" in attrs):
            raise serializers.ValidationError("Task client and deal cannot be changed after creation.")
        if self.instance is None and attrs.get("status", Task.Status.OPEN) != Task.Status.OPEN:
            raise serializers.ValidationError({"status": "New tasks start open."})
        return attrs
