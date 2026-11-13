import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("accounts", "0014_workspace_seller_details"),
        ("clients", "0004_client_bank_details"),
        ("deals", "0004_deal_fx_rate_date"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name="Task",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=250)),
                ("due_at", models.DateTimeField()),
                ("status", models.CharField(choices=[("open", "Open"), ("done", "Done")], default="open", max_length=10)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("assignee", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="assigned_tasks", to=settings.AUTH_USER_MODEL)),
                ("client", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="tasks", to="clients.client")),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="created_tasks", to=settings.AUTH_USER_MODEL)),
                ("deal", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="tasks", to="deals.deal")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="tasks", to="accounts.workspace")),
            ],
        ),
        migrations.AddIndex(
            model_name="task",
            index=models.Index(fields=["workspace", "status", "due_at"], name="task_workspace_due_idx"),
        ),
    ]
