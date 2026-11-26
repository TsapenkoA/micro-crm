from django.core.validators import URLValidator
from rest_framework import serializers

from crm.api.serializers import StrictModelSerializer
from crm.models import Client, ClientContact, ClientLink, ClientNote, Deal, Invoice
from crm.services.calculations import money_string
from crm.workspaces.serializers import BankDetailsSerializer


class ClientSerializer(StrictModelSerializer):
    bank_details = BankDetailsSerializer(required=False)

    class Meta:
        model = Client
        fields = ["id", "workspace", "created_by", "name", "company", "email", "phone", "bank_details", "created_at", "updated_at"]
        read_only_fields = ["id", "workspace", "created_by", "created_at", "updated_at"]

    def create(self, validated_data):
        bank_details = validated_data.pop("bank_details", {})
        client = Client.objects.create(bank_details=bank_details, **validated_data)
        ClientContact.objects.create(client=client, name=client.name, email=client.email, phone=client.phone, is_primary=True)
        return client

    def update(self, instance, validated_data):
        if "bank_details" in validated_data:
            instance.bank_details = validated_data.pop("bank_details")
        client = super().update(instance, validated_data)
        ClientContact.objects.update_or_create(
            client=client, is_primary=True,
            defaults={"name": client.name, "email": client.email, "phone": client.phone},
        )
        return client


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


class ClientInvoiceSerializer(serializers.ModelSerializer):
    total_amount = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = ["id", "invoice_number", "status", "currency", "total_amount", "due_date", "overdue"]
        read_only_fields = fields

    def get_total_amount(self, invoice):
        return money_string(invoice.total_amount, invoice.currency)

    def get_overdue(self, invoice):
        from django.utils import timezone
        return invoice.status == Invoice.Status.SENT and bool(invoice.due_date and invoice.due_date < timezone.localdate())


class ClientContactSerializer(StrictModelSerializer):
    class Meta:
        model = ClientContact
        fields = ["id", "client", "name", "role", "email", "phone", "is_primary", "created_at", "updated_at"]
        read_only_fields = ["id", "client", "created_at", "updated_at"]


class ClientDetailSerializer(ClientSerializer):
    deals = serializers.SerializerMethodField()
    contacts = serializers.SerializerMethodField()

    class Meta(ClientSerializer.Meta):
        fields = [*ClientSerializer.Meta.fields, "deals", "contacts"]

    def get_deals(self, instance):
        deals = instance.deals.filter(workspace_id=self.context["request"].workspace_id).order_by("-created_at", "-id")
        return ClientDealSerializer(deals, many=True).data

    def get_contacts(self, instance):
        return ClientContactSerializer(instance.contacts.order_by("-is_primary", "created_at", "id"), many=True).data


class ClientNoteSerializer(StrictModelSerializer):
    text = serializers.CharField(max_length=10000)
    author = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = ClientNote
        fields = ["id", "client", "deal", "author", "text", "created_at", "can_delete"]
        read_only_fields = ["id", "client", "deal", "author", "created_at"]

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
