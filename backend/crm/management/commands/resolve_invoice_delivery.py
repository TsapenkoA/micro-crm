from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from crm.invoices.delivery_resolution import resolve_invoice_delivery


class Command(BaseCommand):
    help = "Record an investigated invoice email outcome so a failed attempt can be retried."

    def add_arguments(self, parser):
        parser.add_argument("delivery_id")
        parser.add_argument("--outcome", choices=["accepted", "failed"], required=True)
        parser.add_argument("--operator", required=True, help="Username of the platform superuser who investigated the attempt.")
        parser.add_argument("--reason", required=True)

    def handle(self, *args, **options):
        operator = get_user_model().objects.filter(username=options["operator"], is_active=True, is_superuser=True).first()
        if operator is None:
            raise CommandError("The operator must be an active platform superuser.")
        try:
            delivery = resolve_invoice_delivery(options["delivery_id"], options["outcome"], operator, options["reason"])
        except ValueError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS(f"Email attempt {delivery.pk} resolved as {delivery.result}."))
