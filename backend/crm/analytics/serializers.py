from rest_framework import serializers
from crm.services.calculations import CURRENCY_PLACES


class DashboardFilters(serializers.Serializer):
    currency = serializers.ChoiceField(choices=tuple(CURRENCY_PLACES), default="USD")
    period = serializers.ChoiceField(choices=("month", "quarter"), default="month")
