from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def assign_existing_owners(apps, schema_editor):
    Workspace = apps.get_model("accounts", "Workspace")
    Membership = apps.get_model("accounts", "WorkspaceMembership")
    alias = schema_editor.connection.alias
    for workspace in Workspace.objects.using(alias).all().iterator():
        owner_id = Membership.objects.using(alias).filter(workspace_id=workspace.pk).order_by("created_at", "pk").values_list("user_id", flat=True).first()
        if owner_id is not None:
            Workspace.objects.using(alias).filter(pk=workspace.pk).update(owner_id=owner_id)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0009_user_avatar"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="owner",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="owned_workspaces", to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(assign_existing_owners, migrations.RunPython.noop),
    ]
