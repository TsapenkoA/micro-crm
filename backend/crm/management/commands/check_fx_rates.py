from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count
from django.utils import timezone

from crm.models import Deal, FxRate, FxSyncRun, Invoice
from crm.services.fx import ECB_CURRENCIES


class Command(BaseCommand):
    help = "Check the latest ECB import and reporting rate coverage."

    def handle(self, *args, **options):
        latest_run = FxSyncRun.objects.order_by("-started_at", "-pk").first()
        if latest_run is None:
            raise CommandError("No ECB synchronization has been recorded.")
        if latest_run.status != FxSyncRun.Status.SUCCESS:
            raise CommandError(f"The latest ECB synchronization {latest_run.status} at {latest_run.started_at.isoformat()}.")
        if latest_run.finished_at is None or latest_run.finished_at < timezone.now() - timedelta(days=2):
            raise CommandError("The last successful ECB synchronization is stale or incomplete.")

        complete_date = (
            FxRate.objects.filter(currency__in=ECB_CURRENCIES)
            .values("date")
            .annotate(currency_count=Count("currency"))
            .filter(currency_count=len(ECB_CURRENCIES))
            .order_by("-date")
            .values_list("date", flat=True)
            .first()
        )
        if complete_date is None or complete_date < timezone.localdate() - timedelta(days=4):
            raise CommandError("Complete ECB rates for all supported currencies are missing or stale.")

        missing_paid = sum(
            model.objects.filter(status="paid", paid_at__isnull=False, fx_rate_date__isnull=True).count()
            for model in (Deal, Invoice)
        )
        if missing_paid:
            raise CommandError(f"{missing_paid} paid records have no fixed exchange-rate date.")
        self.stdout.write(self.style.SUCCESS(
            f"ECB rates healthy: complete through {complete_date}; last sync {latest_run.finished_at.isoformat()}."
        ))
