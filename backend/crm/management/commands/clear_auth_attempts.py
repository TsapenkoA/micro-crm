from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from crm.models import AuthAttempt


class Command(BaseCommand):
    help = "Remove authentication rate-limit buckets older than one day."

    def handle(self, *args, **options):
        count, _ = AuthAttempt.objects.filter(window_start__lt=timezone.now() - timedelta(days=1)).delete()
        self.stdout.write(f"Removed {count} expired authentication buckets.")
