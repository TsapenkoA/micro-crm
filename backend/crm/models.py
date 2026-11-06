import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator, URLValidator
from django.db import models
from django.db.models import Q


currency_validator = RegexValidator(r"^[A-Z]{3}$", "Use a three-letter uppercase ISO currency code.")


class UUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class ValidatedModel(UUIDModel):
    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


def validate_workspace(instance):
    if instance.workspace_id and instance.created_by_id:
        if not WorkspaceMembership.objects.filter(user_id=instance.created_by_id, workspace_id=instance.workspace_id).exists():
            raise ValidationError({"created_by": "Creator must belong to the workspace."})
    if not instance._state.adding:
        previous = type(instance).objects.get(pk=instance.pk)
        if previous.workspace_id != instance.workspace_id or previous.created_by_id != instance.created_by_id:
            raise ValidationError("Workspace and creator cannot be changed after creation.")
    if getattr(instance, "client_id", None) and instance.client.workspace_id != instance.workspace_id:
        raise ValidationError({"client": "Client must belong to the same workspace."})


class Workspace(ValidatedModel):
    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "accounts"


class WorkspaceMembership(ValidatedModel):
    workspace = models.ForeignKey(Workspace, on_delete=models.PROTECT, related_name="memberships")
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workspace_membership")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "accounts"
        constraints = [
            models.UniqueConstraint(fields=["workspace", "user"], name="workspace_user_unique"),
        ]

    def clean(self):
        if self._state.adding:
            return
        previous = type(self).objects.get(pk=self.pk)
        if previous.user_id != self.user_id:
            raise ValidationError({"user": "A membership's user cannot be changed."})
        if previous.workspace_id != self.workspace_id:
            workspace = previous.workspace
            if workspace.clients.exists() or workspace.deals.exists() or workspace.invoices.exists():
                raise ValidationError({"workspace": "Cannot leave a workspace containing business records. A reviewed data transfer is required."})


class PreviewDataset(ValidatedModel):
    workspace = models.OneToOneField(Workspace, on_delete=models.CASCADE, related_name="preview_dataset")
    payload = models.JSONField(default=dict)

    class Meta:
        app_label = "accounts"


class AuthAttempt(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    window_start = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)

    class Meta:
        app_label = "accounts"


class Client(ValidatedModel):
    workspace = models.ForeignKey("accounts.Workspace", on_delete=models.PROTECT, related_name="clients")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="clients")
    name = models.CharField(max_length=200)
    company = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        validate_workspace(self)

    class Meta:
        app_label = "clients"


class ClientNote(ValidatedModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="client_notes")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "clients"
        ordering = ["created_at", "id"]

    def clean(self):
        if self.client_id and self.author_id:
            if not WorkspaceMembership.objects.filter(user_id=self.author_id, workspace_id=self.client.workspace_id).exists():
                raise ValidationError({"author": "Author must belong to the client's workspace."})


class ClientLink(ValidatedModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="links")
    label = models.CharField(max_length=200)
    url = models.URLField(max_length=2048)
    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self):
        if self.url:
            try:
                URLValidator(schemes=["http", "https"])(self.url)
            except ValidationError as exc:
                raise ValidationError({"url": exc.messages}) from exc

    class Meta:
        app_label = "clients"


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
        app_label = "deals"
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
    issued_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    seller_snapshot = models.JSONField(default=dict, blank=True)
    buyer_snapshot = models.JSONField(default=dict, blank=True)
    subtotal = models.DecimalField(max_digits=20, decimal_places=4, default=0)
    tax_total = models.DecimalField(max_digits=20, decimal_places=4, default=0)
    total_amount = models.DecimalField(max_digits=20, decimal_places=4, default=0)

    class Meta:
        app_label = "invoices"
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
    position = models.PositiveIntegerField(default=0)
    description = models.CharField(max_length=500)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=20, decimal_places=4)
    tax_rate = models.DecimalField(max_digits=7, decimal_places=4, default=0)
    line_total = models.DecimalField(max_digits=20, decimal_places=4)
    tax_amount = models.DecimalField(max_digits=20, decimal_places=4, default=0)

    class Meta:
        app_label = "invoices"
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0) & Q(unit_price__gte=0) & Q(line_total__gte=0) & Q(tax_rate__gte=0) & Q(tax_rate__lte=100) & Q(tax_amount__gte=0), name="invoice_item_values_valid"),
        ]
