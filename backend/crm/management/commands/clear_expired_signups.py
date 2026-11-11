from django.core.management.base import BaseCommand
from django.utils import timezone

from crm.models import PendingSignup


class Command(BaseCommand):
    help = "Remove expired unverified signup requests."

    def handle(self, *args, **options):
        deleted, _ = PendingSignup.objects.filter(expires_at__lte=timezone.now()).delete()
        self.stdout.write(self.style.SUCCESS(f"Removed {deleted} expired signup requests."))
