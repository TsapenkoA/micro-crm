import uuid

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models

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
    from apps.accounts.models import WorkspaceMembership

    if instance.workspace_id and instance.created_by_id:
        if not WorkspaceMembership.objects.filter(user_id=instance.created_by_id, workspace_id=instance.workspace_id).exists():
            raise ValidationError({"created_by": "Creator must belong to the workspace."})
    if not instance._state.adding:
        previous = type(instance).objects.get(pk=instance.pk)
        if previous.workspace_id != instance.workspace_id or previous.created_by_id != instance.created_by_id:
            raise ValidationError("Workspace and creator cannot be changed after creation.")
    if getattr(instance, "client_id", None) and instance.client.workspace_id != instance.workspace_id:
        raise ValidationError({"client": "Client must belong to the same workspace."})
