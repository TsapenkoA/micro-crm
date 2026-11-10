from django.core.validators import URLValidator
from rest_framework import serializers
from crm.api.serializers import StrictModelSerializer
from crm.models import Client, ClientLink, ClientNote, Deal
from crm.workspaces.serializers import BankDetailsSerializer


class ClientSerializer(StrictModelSerializer):
    bank_details = BankDetailsSerializer(required=False)

    class Meta:
        model = Client
        fields = ["id", "workspace", "created_by", "name", "company", "email", "phone", "bank_details", "created_at", "updated_at"]
        read_only_fields = ["id", "workspace", "created_by", "created_at", "updated_at"]

    def create(self, validated_data):
        bank_details = validated_data.pop("bank_details", {})
        return Client.objects.create(bank_details=bank_details, **validated_data)

    def update(self, instance, validated_data):
        if "bank_details" in validated_data:
            instance.bank_details = validated_data.pop("bank_details")
        return super().update(instance, validated_data)


class ClientListSerializer(ClientSerializer):
    bank_details = None
    deal_count = serializers.IntegerField(read_only=True)

    class Meta(ClientSerializer.Meta):
        fields = ["id", "workspace", "created_by", "name", "company", "email", "phone", "created_at", "updated_at", "deal_count"]
        read_only_fields = [*ClientSerializer.Meta.read_only_fields, "deal_count"]


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
