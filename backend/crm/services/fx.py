from datetime import timedelta
from decimal import Decimal

from crm.models import FxRate
from crm.services.calculations import round_money


ECB_CURRENCIES = ("AUD", "CAD", "CHF", "GBP", "JPY", "PLN", "USD")


def rate_date_for(currency, day, max_age=7):
    required = {currency, "USD"} - {"EUR"}
    if required - set(ECB_CURRENCIES):
        return None
    earliest = day - timedelta(days=max_age)
    dates = FxRate.objects.filter(date__gte=earliest, date__lte=day, currency__in=required).values_list("date", flat=True).distinct().order_by("-date")
    for candidate in dates:
        if FxRate.objects.filter(date=candidate, currency__in=required).count() == len(required):
            return candidate
    return None


def common_rate_date(currencies, target, day, max_age=4):
    required = (set(currencies) | {target}) - {"EUR"}
    if required - set(ECB_CURRENCIES):
        return None
    earliest = day - timedelta(days=max_age)
    rates = FxRate.objects.filter(date__gte=earliest, date__lte=day, currency__in=required).values("date", "currency")
    by_date = {}
    for row in rates:
        by_date.setdefault(row["date"], set()).add(row["currency"])
    return max((date for date, found in by_date.items() if required <= found), default=None)


def convert(amount, source, target, rate_date, rates=None):
    if source == target:
        return round_money(amount, target)
    if rate_date is None:
        return None
    codes = {source, target} - {"EUR"}
    if rates is None:
        values = dict(FxRate.objects.filter(date=rate_date, currency__in=codes).values_list("currency", "per_eur"))
    else:
        values = {code: rates[(rate_date, code)] for code in codes if (rate_date, code) in rates}
    if set(values) != codes:
        return None
    from_per_eur = values.get(source, Decimal("1"))
    to_per_eur = values.get(target, Decimal("1"))
    return round_money(amount * to_per_eur / from_per_eur, target)
