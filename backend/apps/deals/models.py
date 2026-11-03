from django.conf import settings
from django.db import models
from django.db.models import Q

from common.models import ValidatedModel, currency_validator, validate_workspace


class Deal(ValidatedModel):
    class Status(models.TextChoices):
        NEW_LEAD = "new_lead", "New lead"
        NEGOTIATION = "negotiation", "Negotiation"
        IN_PROGRESS = "in_progress", "In progress"
        PAID = "paid", "Paid"
        ARCHIVED = "archived", "Archived"

    class Outcome(models.TextChoices):
        NONE = "none", "None"
        LOST = "lost", "Lost"
        CANCELLED = "cancelled", "Cancelled"

    workspace = models.ForeignKey("accounts.Workspace", on_delete=models.PROTECT, related_name="deals")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="deals")
    client = models.ForeignKey("clients.Client", on_delete=models.PROTECT, related_name="deals")
    title = models.CharField(max_length=250)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW_LEAD)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    currency = models.CharField(max_length=3, validators=[currency_validator])
    deadline = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    outcome = models.CharField(max_length=10, choices=Outcome.choices, default=Outcome.NONE)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="deal_amount_nonnegative"),
            models.CheckConstraint(condition=Q(version__gte=1), name="deal_version_positive"),
            models.CheckConstraint(condition=Q(status__in=["new_lead", "negotiation", "in_progress", "paid", "archived"]), name="deal_status_valid"),
            models.CheckConstraint(condition=Q(outcome__in=["none", "lost", "cancelled"]), name="deal_outcome_valid"),
            models.CheckConstraint(condition=Q(status="archived") | Q(outcome="none"), name="deal_outcome_archived"),
            models.CheckConstraint(condition=(Q(status="paid", paid_at__isnull=False) | (~Q(status="paid") & Q(paid_at__isnull=True))), name="deal_paid_at_matches_status"),
        ]

    def clean(self):
        validate_workspace(self)
