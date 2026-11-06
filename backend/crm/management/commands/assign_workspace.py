from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from crm.models import Workspace, WorkspaceMembership


class Command(BaseCommand):
    help = "Assign an existing user to a workspace. Refuse moves out of workspaces containing business records."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("workspace", type=str)

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            user = get_user_model().objects.select_for_update().get(username=options["username"])
            workspace = Workspace.objects.get(pk=options["workspace"])
            membership = WorkspaceMembership.objects.select_for_update().filter(user=user).first()
            if membership is None:
                WorkspaceMembership.objects.create(user=user, workspace=workspace)
            elif membership.workspace_id != workspace.pk:
                membership.workspace = workspace
                membership.save()
        except (get_user_model().DoesNotExist, Workspace.DoesNotExist, ValidationError) as exc:
            raise CommandError("User or workspace not found, or the source workspace contains business records.") from exc
        self.stdout.write(self.style.SUCCESS(f"Assigned {user.username} to workspace {workspace.pk}."))
