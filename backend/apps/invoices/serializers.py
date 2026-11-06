from decimal import Decimal

from rest_framework import serializers

from apps.clients.models import Client
from apps.clients.serializers import StrictModelSerializer
from apps.deals.serializers import WorkspaceClientField
from .calculations import CURRENCY_PLACES, money_string
from .models import Invoice, InvoiceItem


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({field: "This field is not writable." for field in sorted(unknown)})
        return super().to_internal_value(data)


class SellerSerializer(StrictSerializer):
    name = serializers.CharField(max_length=200, trim_whitespace=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    address = serializers.CharField(max_length=500, required=False, allow_blank=True)
    tax_id = serializers.CharField(max_length=100, required=False, allow_blank=True)


class InvoiceItemInputSerializer(StrictSerializer):
    description = serializers.CharField(max_length=500, trim_whitespace=True)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(max_digits=20, decimal_places=4, min_value=Decimal("0"))
    tax_rate = serializers.DecimalField(max_digits=7, decimal_places=4, min_value=Decimal("0"), max_value=Decimal("100"))


class InvoiceWriteSerializer(StrictSerializer):
    client = WorkspaceClientField(queryset=Client.objects.none())
    currency = serializers.ChoiceField(choices=sorted(CURRENCY_PLACES))
    seller = SellerSerializer(required=False)
    items = InvoiceItemInputSerializer(many=True, allow_empty=False, max_length=100)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["client"].queryset = Client.objects.filter(workspace_id=self.context["request"].workspace_id)

    def validate(self, attrs):
        if self.instance is None:
            for field in ("client", "currency", "items"):
                if field not in attrs:
                    raise serializers.ValidationError({field: "This field is required."})
        return attrs


class InvoiceStatusSerializer(StrictSerializer):
    status = serializers.ChoiceField(choices=[Invoice.Status.SENT, Invoice.Status.PAID])


class InvoiceItemOutputSerializer(serializers.ModelSerializer):
    unit_price = serializers.SerializerMethodField()
    line_total = serializers.SerializerMethodField()
    tax_amount = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceItem
        fields = ["id", "position", "description", "quantity", "unit_price", "tax_rate", "line_total", "tax_amount"]

    def get_unit_price(self, item):
        return f"{item.unit_price:.4f}"

    def get_line_total(self, item):
        return money_string(item.line_total, self.context["currency"])

    def get_tax_amount(self, item):
        return money_string(item.tax_amount, self.context["currency"])


class InvoiceOutputSerializer(StrictModelSerializer):
    items = serializers.SerializerMethodField()
    subtotal = serializers.SerializerMethodField()
    tax_total = serializers.SerializerMethodField()
    total_amount = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = ["id", "invoice_number", "client", "created_by", "currency", "status", "issued_at", "paid_at", "seller_snapshot", "buyer_snapshot", "items", "subtotal", "tax_total", "total_amount", "created_at", "updated_at"]
        read_only_fields = fields

    def get_items(self, invoice):
        return InvoiceItemOutputSerializer(invoice.items.all(), many=True, context={"currency": invoice.currency}).data

    def get_subtotal(self, invoice):
        return money_string(invoice.subtotal, invoice.currency)

    def get_tax_total(self, invoice):
        return money_string(invoice.tax_total, invoice.currency)

    def get_total_amount(self, invoice):
        return money_string(invoice.total_amount, invoice.currency)
