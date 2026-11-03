from django.core.validators import URLValidator
from rest_framework import serializers

from apps.deals.models import Deal
from .models import Client, ClientLink, ClientNote


class StrictModelSerializer(serializers.ModelSerializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {name for name, field in self.fields.items() if not field.read_only}
            forbidden = set(data) - writable
            if forbidden:
                raise serializers.ValidationError({field: "This field is not writable." for field in sorted(forbidden)})
        return super().to_internal_value(data)


class ClientSerializer(StrictModelSerializer):
    class Meta:
        model = Client
        fields = ["id", "workspace", "created_by", "name", "company", "email", "phone", "created_at", "updated_at"]
        read_only_fields = ["id", "workspace", "created_by", "created_at", "updated_at"]


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


class ClientNoteSerializer(StrictModelSerializer):
    text = serializers.CharField(max_length=10000)
    author = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = ClientNote
        fields = ["id", "client", "author", "text", "created_at", "can_delete"]
        read_only_fields = ["id", "client", "author", "created_at"]

    def get_author(self, instance):
        return {"id": instance.author_id, "username": instance.author.username}

    def get_can_delete(self, instance):
        return instance.author_id == self.context["request"].user.pk


class ClientLinkSerializer(StrictModelSerializer):
    url = serializers.URLField(max_length=2048, validators=[URLValidator(schemes=["http", "https"])])

    class Meta:
        model = ClientLink
        fields = ["id", "client", "label", "url", "created_at"]
        read_only_fields = ["id", "client", "created_at"]
