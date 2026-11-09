import csv
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from io import StringIO
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from crm.models import FxRate
from crm.services.fx import ECB_CURRENCIES


BASE_URL = "https://data-api.ecb.europa.eu/service/data/EXR/"
MAX_RESPONSE_BYTES = 5_000_000


def parse_rates(content, since, until):
    reader = csv.DictReader(StringIO(content.decode("utf-8-sig")))
    required = {"FREQ", "CURRENCY", "CURRENCY_DENOM", "TIME_PERIOD", "OBS_VALUE"}
    if not reader.fieldnames or not required <= set(reader.fieldnames):
        raise CommandError("The ECB response is missing required CSV columns.")
    rates = {}
    for row in reader:
        if row["FREQ"] != "D" or row["CURRENCY_DENOM"] != "EUR" or row["CURRENCY"] not in ECB_CURRENCIES:
            continue
        try:
            day = date.fromisoformat(row["TIME_PERIOD"])
            value = Decimal(row["OBS_VALUE"])
        except (TypeError, ValueError, InvalidOperation) as exc:
            raise CommandError("The ECB response contains an invalid rate.") from exc
        if not value.is_finite() or value <= 0 or value.as_tuple().exponent < -12:
            raise CommandError("The ECB response contains an unsupported rate.")
        if not since <= day <= until:
            continue
        key = (day, row["CURRENCY"])
        if key in rates and rates[key] != value:
            raise CommandError("The ECB response contains conflicting rates.")
        rates[key] = value
    if not rates:
        raise CommandError("The ECB response contains no usable rates for this period.")
    return rates


class Command(BaseCommand):
    help = "Import immutable daily ECB reference rates for reporting."

    def add_arguments(self, parser):
        parser.add_argument("--since", help="First date to import (YYYY-MM-DD); defaults to 90 days ago.")
        parser.add_argument("--until", help="Last date to import (YYYY-MM-DD); defaults to today.")

    def handle(self, *args, **options):
        try:
            until = date.fromisoformat(options["until"]) if options["until"] else date.today()
            since = date.fromisoformat(options["since"]) if options["since"] else until - timedelta(days=90)
        except ValueError as exc:
            raise CommandError("Use YYYY-MM-DD for --since and --until.") from exc
        if since > until or (until - since).days > 3660:
            raise CommandError("Choose a valid date range of at most ten years.")
        key = "+".join(ECB_CURRENCIES)
        query = urlencode({"startPeriod": since.isoformat(), "endPeriod": until.isoformat(), "format": "csvdata"})
        request = Request(f"{BASE_URL}D.{key}.EUR.SP00.A?{query}", headers={"Accept": "text/csv", "User-Agent": "MicroFlow/1.0"})
        try:
            with urlopen(request, timeout=20) as response:
                content = response.read(MAX_RESPONSE_BYTES + 1)
        except (OSError, URLError) as exc:
            raise CommandError("Unable to fetch ECB reference rates.") from exc
        if len(content) > MAX_RESPONSE_BYTES:
            raise CommandError("The ECB response is too large.")
        rates = parse_rates(content, since, until)
        with transaction.atomic():
            existing = {(row.date, row.currency): row.per_eur for row in FxRate.objects.filter(date__gte=since, date__lte=until)}
            conflicts = [key for key, value in rates.items() if key in existing and existing[key] != value]
            if conflicts:
                raise CommandError(f"{len(conflicts)} stored rates differ from ECB. Review before changing historical rates.")
            new = [FxRate(date=day, currency=currency, per_eur=value) for (day, currency), value in rates.items() if (day, currency) not in existing]
            FxRate.objects.bulk_create(new)
        self.stdout.write(self.style.SUCCESS(f"Imported {len(new)} ECB rates; {len(rates) - len(new)} already stored."))
