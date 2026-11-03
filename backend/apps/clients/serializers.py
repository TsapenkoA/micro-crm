from rest_framework import serializers

from apps.deals.models import Deal
from .models import Client


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = ["id", "workspace", "created_by", "name", "company", "email", "phone", "created_at", "updated_at"]
        read_only_fields = ["id", "workspace", "created_by", "created_at", "updated_at"]

    def to_internal_value(self, data):
        if isinstance(data, dict):
            forbidden = set(data) - {"name", "company", "email", "phone"}
            if forbidden:
                raise serializers.ValidationError({field: "This field is not writable." for field in sorted(forbidden)})
        return super().to_internal_value(data)


class ClientDealSerializer(serializers.ModelSerializer):
    class Meta:
        model = Deal
        fields = ["id", "title", "status", "amount", "currency", "deadline"]
        read_only_fields = fields


class ClientDetailSerializer(ClientSerializer):
    deals = serializers.SerializerMethodField()

    class Meta(ClientSerializer.Meta):
        fields = [*ClientSerializer.Meta.fields, "deals"]

    def get_deals(self, instance):
        deals = instance.deals.filter(workspace_id=self.context["request"].workspace_id).order_by("-created_at", "-id")
        return ClientDealSerializer(deals, many=True).data
