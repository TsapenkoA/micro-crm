from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from common.models import ValidatedModel, validate_workspace


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


class ClientNote(ValidatedModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="client_notes")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def clean(self):
        from apps.accounts.models import WorkspaceMembership

        if self.client_id and self.author_id:
            if not WorkspaceMembership.objects.filter(user_id=self.author_id, workspace_id=self.client.workspace_id).exists():
                raise ValidationError({"author": "Author must belong to the client's workspace."})


class ClientLink(ValidatedModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="links")
    label = models.CharField(max_length=200)
    url = models.URLField(max_length=2048)
    created_at = models.DateTimeField(auto_now_add=True)
