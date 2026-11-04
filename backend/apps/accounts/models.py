from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from common.models import ValidatedModel


class Workspace(ValidatedModel):
    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class WorkspaceMembership(ValidatedModel):
    workspace = models.ForeignKey(Workspace, on_delete=models.PROTECT, related_name="memberships")
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workspace_membership")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
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


class AuthAttempt(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    window_start = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)
