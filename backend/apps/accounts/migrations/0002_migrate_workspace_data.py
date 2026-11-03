from django.conf import settings
from django.db import migrations
from django.db.models import F


def migrate_workspace_data(apps, schema_editor):
    alias = schema_editor.connection.alias
    User = apps.get_model(settings.AUTH_USER_MODEL)
    Workspace = apps.get_model("accounts", "Workspace")
    Membership = apps.get_model("accounts", "WorkspaceMembership")
    Client = apps.get_model("clients", "Client")
    Note = apps.get_model("clients", "ClientNote")
    Deal = apps.get_model("deals", "Deal")
    Invoice = apps.get_model("invoices", "Invoice")

    for Model in (Deal, Invoice):
        if Model.objects.using(alias).exclude(created_by_id=F("client__created_by_id")).exists():
            raise RuntimeError("Workspace migration stopped: inconsistent legacy client ownership. No business records were changed.")
    if Note.objects.using(alias).exclude(author_id=F("client__created_by_id")).exists():
        raise RuntimeError("Workspace migration stopped: inconsistent legacy note authorship. No business records were changed.")

    for user in User.objects.using(alias).all().iterator():
        membership = Membership.objects.using(alias).filter(user_id=user.pk).first()
        if membership is None:
            workspace = Workspace.objects.using(alias).create(name=f"{user.username}'s workspace")
            membership = Membership.objects.using(alias).create(user_id=user.pk, workspace=workspace)
        for Model in (Client, Deal, Invoice):
            Model.objects.using(alias).filter(created_by_id=user.pk).update(workspace_id=membership.workspace_id)

    for Model in (Client, Deal, Invoice):
        if Model.objects.using(alias).filter(workspace__isnull=True).exists():
            raise RuntimeError("Workspace migration stopped: a business record has no workspace.")


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"), ("clients", "0002_workspace"),
        ("deals", "0002_workspace"), ("invoices", "0002_workspace"),
    ]
    operations = [migrations.RunPython(migrate_workspace_data)]
