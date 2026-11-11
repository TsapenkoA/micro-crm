from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.core.mail import send_mail
from django.utils import timezone


class Command(BaseCommand):
    help = "Import ECB rates, fix missing paid-record rate dates and check coverage."

    def handle(self, *args, **options):
        try:
            for command in ("sync_fx_rates", "snapshot_fx_rates", "check_fx_rates"):
                call_command(command, stdout=self.stdout)
        except Exception:
            if settings.FX_ALERT_EMAIL:
                try:
                    send_mail(
                        "MicroFlow exchange-rate maintenance failed",
                        f"The exchange-rate maintenance job failed at {timezone.now().isoformat()}. Check the job log and rerun it after resolving the issue.",
                        settings.DEFAULT_FROM_EMAIL,
                        [settings.FX_ALERT_EMAIL],
                    )
                except Exception:
                    self.stderr.write("The exchange-rate alert could not be delivered.")
            raise
