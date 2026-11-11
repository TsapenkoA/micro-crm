import time

from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_save
from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver

from crm.models import Workspace, WorkspaceMembership


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_workspace(sender, instance, created, raw, using, **kwargs):
    if created and not raw:
        with transaction.atomic(using=using):
            workspace = Workspace.objects.using(using).create(name=f"{instance.username}'s workspace", owner=instance)
            WorkspaceMembership.objects.using(using).create(workspace=workspace, user=instance)


@receiver(user_logged_in)
def remember_authentication(sender, request, user, **kwargs):
    request.session["auth_time"] = time.time()
    request.session["reauth_user"] = str(user.pk)
