import re
from decimal import Decimal

from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework import serializers

from apps.clients.models import Client
from apps.clients.serializers import StrictModelSerializer
from .models import Deal


CURRENCIES = frozenset("""
AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN
BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD
EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR
IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL
LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR
NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP
SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN
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
        fields = ["id", "title", "client", "status", "amount", "currency", "deadline", "version", "outcome", "paid_at", "created_at", "updated_at"]
        read_only_fields = ["id", "paid_at", "created_at", "updated_at"]
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
