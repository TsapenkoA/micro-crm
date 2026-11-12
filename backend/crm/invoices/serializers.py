from decimal import Decimal
from django.utils import timezone
from rest_framework import serializers
from crm.api.serializers import StrictModelSerializer, StrictSerializer, WorkspaceClientField
from crm.models import Client, Deal, Invoice, InvoiceDelivery, InvoiceItem, InvoicePayment
from crm.services.calculations import CURRENCY_PLACES, money_string


class SellerSerializer(StrictSerializer):
    name = serializers.CharField(max_length=200, trim_whitespace=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=80, required=False, allow_blank=True)
    address = serializers.CharField(max_length=500, required=False, allow_blank=True)
    tax_id = serializers.CharField(max_length=100, required=False, allow_blank=True)


class InvoiceItemInputSerializer(StrictSerializer):
    description = serializers.CharField(max_length=500, trim_whitespace=True)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(max_digits=20, decimal_places=4, min_value=Decimal("0"))
    tax_rate = serializers.DecimalField(max_digits=7, decimal_places=4, min_value=Decimal("0"), max_value=Decimal("100"))


class InvoiceWriteSerializer(StrictSerializer):
    client = WorkspaceClientField(queryset=Client.objects.none())
    deal = WorkspaceClientField(queryset=Deal.objects.none(), required=False, allow_null=True)
    currency = serializers.ChoiceField(choices=sorted(CURRENCY_PLACES))
    due_date = serializers.DateField(required=False, allow_null=True)
    payment_terms = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=True)
    seller = SellerSerializer(required=False)
    items = InvoiceItemInputSerializer(many=True, allow_empty=False, max_length=100)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["client"].queryset = Client.objects.filter(workspace_id=self.context["request"].workspace_id)
        self.fields["deal"].queryset = Deal.objects.filter(workspace_id=self.context["request"].workspace_id)

    def validate(self, attrs):
        if self.instance is None:
            for field in ("client", "currency", "items"):
                if field not in attrs:
                    raise serializers.ValidationError({field: "This field is required."})
        client = attrs.get("client", self.instance.client if self.instance else None)
        deal = attrs.get("deal", self.instance.deal if self.instance else None)
        if deal and client and deal.client_id != client.pk:
            raise serializers.ValidationError({"deal": "Choose a deal for this client."})
        return attrs


class InvoiceStatusSerializer(StrictSerializer):
    status = serializers.ChoiceField(choices=[Invoice.Status.SENT, Invoice.Status.PAID])


class InvoicePaymentInputSerializer(StrictSerializer):
    amount = serializers.DecimalField(max_digits=20, decimal_places=4, min_value=Decimal("0.0001"))
    received_on = serializers.DateField(required=False)
    reference = serializers.CharField(max_length=200, required=False, allow_blank=True, trim_whitespace=True)


class InvoiceCancelSerializer(StrictSerializer):
    reason = serializers.CharField(max_length=500, trim_whitespace=True)


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
    payments = serializers.SerializerMethodField()
    paid_amount = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()
    deliveries = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = ["id", "invoice_number", "client", "deal", "created_by", "currency", "status", "issued_at", "due_date", "payment_terms", "paid_at", "cancelled_at", "cancellation_reason", "fx_rate_date", "seller_snapshot", "buyer_snapshot", "items", "subtotal", "tax_total", "total_amount", "payments", "paid_amount", "balance_due", "overdue", "deliveries", "created_at", "updated_at"]
        read_only_fields = fields

    def get_items(self, invoice):
        return InvoiceItemOutputSerializer(invoice.items.all(), many=True, context={"currency": invoice.currency}).data

    def get_subtotal(self, invoice):
        return money_string(invoice.subtotal, invoice.currency)

    def get_tax_total(self, invoice):
        return money_string(invoice.tax_total, invoice.currency)

    def get_total_amount(self, invoice):
        return money_string(invoice.total_amount, invoice.currency)

    def get_payments(self, invoice):
        return InvoicePaymentOutputSerializer(invoice.payments.all(), many=True).data

    def get_paid_amount(self, invoice):
        return money_string(sum((payment.amount for payment in invoice.payments.all()), Decimal("0")), invoice.currency)

    def get_balance_due(self, invoice):
        paid = sum((payment.amount for payment in invoice.payments.all()), Decimal("0"))
        return money_string(max(invoice.total_amount - paid, Decimal("0")), invoice.currency)

    def get_overdue(self, invoice):
        return invoice.status == Invoice.Status.SENT and invoice.due_date is not None and invoice.due_date < timezone.localdate() and Decimal(self.get_balance_due(invoice)) > 0

    def get_deliveries(self, invoice):
        return InvoiceDeliveryOutputSerializer(invoice.deliveries.all(), many=True).data


class InvoicePaymentOutputSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoicePayment
        fields = ["id", "amount", "received_on", "reference", "is_legacy", "created_at"]


class InvoiceDeliveryOutputSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceDelivery
        fields = ["id", "kind", "result", "recipient", "attempted_at"]
