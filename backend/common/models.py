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


def validate_client_owner(instance):
    if instance.client_id and instance.owner_id and instance.client.owner_id != instance.owner_id:
        raise ValidationError({"client": "Client must belong to the same owner."})
