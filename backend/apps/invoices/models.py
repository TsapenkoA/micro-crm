from django.conf import settings
from django.db import models
from django.db.models import Q

from common.models import ValidatedModel, currency_validator, validate_workspace


class Invoice(ValidatedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        PAID = "paid", "Paid"

    workspace = models.ForeignKey("accounts.Workspace", on_delete=models.PROTECT, related_name="invoices")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="invoices")
    client = models.ForeignKey("clients.Client", on_delete=models.PROTECT, related_name="invoices")
    invoice_number = models.CharField(max_length=50)
    currency = models.CharField(max_length=3, validators=[currency_validator])
    tax_rate = models.DecimalField(max_digits=7, decimal_places=4, default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    seller_snapshot = models.JSONField(default=dict, blank=True)
    buyer_snapshot = models.JSONField(default=dict, blank=True)
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "invoice_number"], name="invoice_workspace_number_unique"),
            models.CheckConstraint(condition=Q(tax_rate__gte=0), name="invoice_tax_nonnegative"),
            models.CheckConstraint(condition=Q(subtotal__gte=0) & Q(tax_total__gte=0) & Q(total_amount__gte=0), name="invoice_totals_nonnegative"),
            models.CheckConstraint(condition=Q(status__in=["draft", "sent", "paid"]), name="invoice_status_valid"),
            models.CheckConstraint(condition=(Q(status="paid", paid_at__isnull=False) | (~Q(status="paid") & Q(paid_at__isnull=True))), name="invoice_paid_at_matches_status"),
        ]

    def clean(self):
        validate_workspace(self)


class InvoiceItem(ValidatedModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="items")
    description = models.CharField(max_length=500)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=18, decimal_places=2)
    line_total = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gte=0) & Q(unit_price__gte=0) & Q(line_total__gte=0), name="invoice_item_values_nonnegative"),
        ]
