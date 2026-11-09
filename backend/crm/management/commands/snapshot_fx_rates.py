from django.core.management.base import BaseCommand
from django.utils import timezone

from crm.models import Deal, Invoice
from crm.services.fx import rate_date_for


class Command(BaseCommand):
    help = "Fix ECB rate dates for previously paid deals and invoices when rates are available."

    def handle(self, *args, **options):
        updated = missing = 0
        for model in (Deal, Invoice):
            records = model.objects.filter(status="paid", fx_rate_date__isnull=True, paid_at__isnull=False).only("id", "currency", "paid_at").iterator()
            for record in records:
                day = timezone.localtime(record.paid_at).date()
                rate_date = rate_date_for(record.currency, day)
                if rate_date is None:
                    missing += 1
                    continue
                updated += model.objects.filter(pk=record.pk, fx_rate_date__isnull=True).update(fx_rate_date=rate_date)
        self.stdout.write(f"Fixed {updated} rate dates; {missing} paid records still lack a supported rate.")
