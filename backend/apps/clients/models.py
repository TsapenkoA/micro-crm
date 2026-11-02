from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from common.models import ValidatedModel


class Client(ValidatedModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="clients")
    name = models.CharField(max_length=200)
    company = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ClientNote(ValidatedModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="client_notes")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def clean(self):
        if self.client_id and self.author_id and self.client.owner_id != self.author_id:
            raise ValidationError({"author": "Author must own the client."})


class ClientLink(ValidatedModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="links")
    label = models.CharField(max_length=200)
    url = models.URLField(max_length=2048)
    created_at = models.DateTimeField(auto_now_add=True)
