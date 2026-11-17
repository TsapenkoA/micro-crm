from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from crm.models import InvoiceDelivery


class Command(BaseCommand):
    help = "Record an investigated invoice email outcome so a failed attempt can be retried."

    def add_arguments(self, parser):
        parser.add_argument("delivery_id")
        parser.add_argument("--outcome", choices=["accepted", "failed"], required=True)
        parser.add_argument("--operator", required=True, help="Username of the platform superuser who investigated the attempt.")
        parser.add_argument("--reason", required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        reason = options["reason"].strip()
        if not reason or len(reason) > 500:
            raise CommandError("Give a reason of 1 to 500 characters.")
        operator = get_user_model().objects.filter(username=options["operator"], is_active=True, is_superuser=True).first()
        if operator is None:
            raise CommandError("The operator must be an active platform superuser.")
        delivery = InvoiceDelivery.objects.select_for_update().filter(pk=options["delivery_id"]).first()
        if delivery is None:
            raise CommandError("Email attempt not found.")
        if delivery.result not in (InvoiceDelivery.Result.PENDING, InvoiceDelivery.Result.UNKNOWN) or delivery.resolved_at is not None:
            raise CommandError("Only an unresolved pending or unknown attempt can be resolved.")
        delivery.result = options["outcome"]
        delivery.resolved_at = timezone.now()
        delivery.resolved_by = operator
        delivery.resolution_reason = reason
        delivery.save(update_fields=["result", "resolved_at", "resolved_by", "resolution_reason"])
        self.stdout.write(self.style.SUCCESS(f"Email attempt {delivery.pk} resolved as {delivery.result}."))
