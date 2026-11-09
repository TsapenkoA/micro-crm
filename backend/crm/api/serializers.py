from decimal import Decimal
import re

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import serializers

from crm.services.calculations import CURRENCY_PLACES, money_string
from crm.models import Deal, Client, ClientLink, ClientNote, Invoice, InvoiceItem


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


class ClientListSerializer(ClientSerializer):
    deal_count = serializers.IntegerField(read_only=True)

    class Meta(ClientSerializer.Meta):
        fields = [*ClientSerializer.Meta.fields, "deal_count"]
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


CURRENCIES = frozenset("""
AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN
BWP BYN BZD CAD CDF CHE CHF CHW CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD
EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR
IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KYD KZT LAK LBP LKR LRD LSL
LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR
NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP
SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UGX USD USN
UYI UYU UYW UZS VED VES VND VUV WST XAD XAF XCD XCG XOF XPF YER ZAR ZMW ZWG
""".split())


class DeadlineField(serializers.DateTimeField):
    def to_internal_value(self, value):
        if isinstance(value, str) and not re.search(r"(?:Z|[+-]\d{2}:\d{2})$", value):
            raise serializers.ValidationError("Use an ISO 8601 datetime with a timezone offset.")
        if hasattr(value, "tzinfo") and timezone.is_naive(value):
            raise serializers.ValidationError("A timezone offset is required.")
        return super().to_internal_value(value)


class VersionField(serializers.IntegerField):
    def to_internal_value(self, value):
        if isinstance(value, bool) or not isinstance(value, int):
            raise serializers.ValidationError("Use a positive integer version.")
        return super().to_internal_value(value)


class WorkspaceClientField(serializers.PrimaryKeyRelatedField):
    def to_internal_value(self, value):
        pk = serializers.UUIDField().run_validation(value)
        return get_object_or_404(self.get_queryset(), pk=pk)


class DealSerializer(StrictModelSerializer):
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0"), coerce_to_string=True)
    currency = serializers.ChoiceField(choices=sorted(CURRENCIES))
    deadline = DeadlineField(required=False, allow_null=True)
    version = VersionField(min_value=1, max_value=2147483647, required=False)
    client = WorkspaceClientField(queryset=Client.objects.none())

    class Meta:
        model = Deal
        fields = ["id", "title", "client", "status", "amount", "currency", "deadline", "version", "outcome", "paid_at", "fx_rate_date", "created_at", "updated_at"]
        read_only_fields = ["id", "paid_at", "fx_rate_date", "created_at", "updated_at"]
        validators = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if "client" in self.fields:
            self.fields["client"].queryset = Client.objects.filter(workspace_id=self.context["request"].workspace_id)

    def validate(self, attrs):
        if self.instance is None:
            if "version" in attrs:
                raise serializers.ValidationError({"version": "The initial version is assigned by the server."})
        elif "version" not in attrs:
            raise serializers.ValidationError({"version": "This field is required."})
        status = attrs.get("status", self.instance.status if self.instance else Deal.Status.NEW_LEAD)
        outcome = attrs.get("outcome", self.instance.outcome if self.instance else Deal.Outcome.NONE)
        if status != Deal.Status.ARCHIVED:
            if "outcome" in attrs and outcome != Deal.Outcome.NONE:
                raise serializers.ValidationError({"outcome": "An outcome is only allowed for archived deals."})
            attrs["outcome"] = Deal.Outcome.NONE
        return attrs


class DealStatusSerializer(DealSerializer):
    class Meta(DealSerializer.Meta):
        fields = ["status", "outcome", "version"]
        read_only_fields = []
        extra_kwargs = {"status": {"required": True}}

    def validate(self, attrs):
        if "status" not in attrs:
            raise serializers.ValidationError({"status": "This field is required."})
        return super().validate(attrs)


class DealDeleteSerializer(serializers.Serializer):
    version = VersionField(min_value=1, max_value=2147483647)

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - {"version"}:
            raise serializers.ValidationError("Only version is accepted when deleting a deal.")
        return super().to_internal_value(data)


class DealFilters(serializers.Serializer):
    status = serializers.ChoiceField(choices=Deal.Status.choices, required=False)
    currency = serializers.ChoiceField(choices=sorted(CURRENCIES), required=False)


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
        fields = ["id", "invoice_number", "client", "created_by", "currency", "status", "issued_at", "paid_at", "fx_rate_date", "seller_snapshot", "buyer_snapshot", "items", "subtotal", "tax_total", "total_amount", "created_at", "updated_at"]
        read_only_fields = fields

    def get_items(self, invoice):
        return InvoiceItemOutputSerializer(invoice.items.all(), many=True, context={"currency": invoice.currency}).data

    def get_subtotal(self, invoice):
        return money_string(invoice.subtotal, invoice.currency)

    def get_tax_total(self, invoice):
        return money_string(invoice.tax_total, invoice.currency)

    def get_total_amount(self, invoice):
        return money_string(invoice.total_amount, invoice.currency)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=254, required=False)
    email = serializers.EmailField(max_length=254, required=False)
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=4096)

    def validate(self, attrs):
        if bool(attrs.get("username")) == bool(attrs.get("email")):
            raise serializers.ValidationError("Provide an email address or username.")
        return attrs


def check_password(value, user):
    try:
        validate_password(value, user)
    except DjangoValidationError as error:
        raise serializers.ValidationError({"password": error.messages})


class NewPasswordSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False, max_length=4096)
    password_confirm = serializers.CharField(trim_whitespace=False, max_length=4096)

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": ["Passwords do not match."]})
        return attrs


class UsernameSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, validators=[UnicodeUsernameValidator()])

    def validate_username(self, value):
        if "@" in value:
            raise serializers.ValidationError("Use a username without @; enter your email separately.")
        users = get_user_model().objects.filter(username__iexact=value)
        if self.instance:
            users = users.exclude(pk=self.instance.pk)
        if users.exists():
            raise serializers.ValidationError("This username is already taken.")
        return value


class SignupSerializer(NewPasswordSerializer, UsernameSerializer):
    email = serializers.EmailField(max_length=254)


class EmailSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class ResetSerializer(NewPasswordSerializer):
    uid = serializers.CharField(max_length=100)
    token = serializers.CharField(max_length=200)


class DashboardFilters(serializers.Serializer):
    currency = serializers.ChoiceField(choices=tuple(CURRENCY_PLACES), default="USD")
    period = serializers.ChoiceField(choices=("month", "quarter"), default="month")
