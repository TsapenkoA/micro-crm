import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers

from crm.api.serializers import SingleLineField


class WorkspaceNameSerializer(serializers.Serializer):
    name = SingleLineField(max_length=200, allow_blank=False, trim_whitespace=True)


class WorkspaceTimezoneSerializer(serializers.Serializer):
    time_zone = serializers.CharField(max_length=64, trim_whitespace=True)

    def validate_time_zone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise serializers.ValidationError("Choose a valid IANA time zone, such as Europe/Kyiv.") from error
        return value


class SellerDetailsSerializer(serializers.Serializer):
    name = SingleLineField(max_length=200, trim_whitespace=True)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=80, required=False, allow_blank=True, trim_whitespace=True)
    address = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=True)
    tax_id = serializers.CharField(max_length=100, required=False, allow_blank=True, trim_whitespace=True)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError("Enter seller details as an object.")
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({field: "This field is not writable." for field in sorted(unknown)})
        return super().to_internal_value(data)


class BankDetailsSerializer(serializers.Serializer):
    account_holder = serializers.CharField(max_length=200, required=False, allow_blank=True, trim_whitespace=True)
    bank_name = serializers.CharField(max_length=200, required=False, allow_blank=True, trim_whitespace=True)
    iban = serializers.CharField(max_length=34, required=False, allow_blank=True, trim_whitespace=True)
    bic = serializers.CharField(max_length=11, required=False, allow_blank=True, trim_whitespace=True)
    account_number = serializers.CharField(max_length=80, required=False, allow_blank=True, trim_whitespace=True)
    routing_number = serializers.CharField(max_length=80, required=False, allow_blank=True, trim_whitespace=True)
    payment_instructions = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=True)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError("Enter bank details as an object.")
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({field: "This field is not writable." for field in sorted(unknown)})
        return super().to_internal_value(data)

    def validate_iban(self, value):
        value = value.replace(" ", "").upper()
        if value and not re.fullmatch(r"[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}", value):
            raise serializers.ValidationError("Enter an IBAN with 15 to 34 letters and digits.")
        return value

    def validate_bic(self, value):
        value = value.upper()
        if value and not re.fullmatch(r"[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?", value):
            raise serializers.ValidationError("Enter an 8 or 11 character BIC/SWIFT code.")
        return value
