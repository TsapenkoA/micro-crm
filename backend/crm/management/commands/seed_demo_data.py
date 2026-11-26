import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from crm.models import Client, Deal, Invoice, InvoiceItem, Task, Workspace

DEMO_CLIENTS = (
    {"name": "Avery Example", "company": "[DEMO] Cedar & Finch Studio", "email": "avery@cedar-finch.example.test", "phone": "+1-202-555-0101"},
    {"name": "Jordan Sample", "company": "[DEMO] Orbit Labs", "email": "jordan@orbit-labs.example.test", "phone": "+1-202-555-0102"},
)
DEMO_DEAL_TITLES = ("[DEMO] Website refresh", "[DEMO] Brand identity")
DEMO_TASK_TITLES = ("[DEMO] Prepare discovery questions", "[DEMO] Review design proposal")
DEMO_INVOICE_NUMBER = "DEMO-INV-001"


class Command(BaseCommand):
    help = "Create clearly marked synthetic CRM records in a development workspace."

    def add_arguments(self, parser):
        parser.add_argument("workspace_id")
        parser.add_argument("--confirm", action="store_true", help="Confirm that synthetic records will be added to this workspace.")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Demo data can only be created when DEBUG is enabled.")
        if not options["confirm"]:
            raise CommandError("Pass --confirm to add synthetic records to the selected workspace.")
        try:
            workspace_id = uuid.UUID(options["workspace_id"])
        except (ValueError, TypeError) as error:
            raise CommandError("Provide a valid workspace UUID.") from error

        workspace = Workspace.objects.select_for_update().filter(pk=workspace_id).first()
        if workspace is None or workspace.owner is None:
            raise CommandError("Choose a workspace with an active owner.")

        if (
            Client.objects.filter(workspace=workspace, company__in=[client["company"] for client in DEMO_CLIENTS]).exists()
            or Deal.objects.filter(workspace=workspace, title__in=DEMO_DEAL_TITLES).exists()
            or Task.objects.filter(workspace=workspace, title__in=DEMO_TASK_TITLES).exists()
            or Invoice.objects.filter(workspace=workspace, invoice_number=DEMO_INVOICE_NUMBER).exists()
        ):
            raise CommandError("Demo marker records already exist; refusing to duplicate or overwrite them.")

        owner = workspace.owner
        now = timezone.now()
        today = timezone.localdate()
        clients = [
            Client.objects.create(workspace=workspace, created_by=owner, **values)
            for values in DEMO_CLIENTS
        ]
        Deal.objects.create(
            workspace=workspace, created_by=owner, client=clients[0],
            title=DEMO_DEAL_TITLES[0], amount=Decimal("4800.00"), currency="USD",
            status=Deal.Status.NEW_LEAD, deadline=now + timedelta(days=7),
        )
        Deal.objects.create(
            workspace=workspace, created_by=owner, client=clients[1],
            title=DEMO_DEAL_TITLES[1], amount=Decimal("2600.00"), currency="EUR",
            status=Deal.Status.IN_PROGRESS, deadline=now + timedelta(days=14),
        )
        for index, title in enumerate(DEMO_TASK_TITLES):
            Task.objects.create(
                workspace=workspace, client=clients[index], created_by=owner, assignee=owner,
                title=title, due_at=now + timedelta(days=index + 1),
            )

        invoice = Invoice.objects.create(
            workspace=workspace,
            created_by=owner,
            client=clients[0],
            invoice_number=DEMO_INVOICE_NUMBER,
            currency="USD",
            status=Invoice.Status.SENT,
            issued_at=now,
            issued_on=today,
            due_date=today + timedelta(days=30),
            seller_snapshot={"name": "Example Studio", "email": "billing@example.test", "address": "100 Demo Avenue"},
            buyer_snapshot={"name": clients[0].name, "company": clients[0].company, "email": clients[0].email, "phone": clients[0].phone},
            subtotal=Decimal("850.00"),
            tax_total=Decimal("0.00"),
            total_amount=Decimal("850.00"),
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            position=0,
            description="Synthetic design services",
            quantity=Decimal("1.000"),
            unit_price=Decimal("850.0000"),
            tax_rate=Decimal("0.0000"),
            line_total=Decimal("850.0000"),
            tax_amount=Decimal("0.0000"),
        )
        self.stdout.write(self.style.SUCCESS(
            f"Created 2 synthetic clients, 2 deals, 2 tasks and 1 invoice in workspace {workspace.pk}."
        ))
