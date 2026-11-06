from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial"), ("clients", "0001_initial")]
    operations = [
        migrations.RenameField(model_name="client", old_name="owner", new_name="created_by"),
        migrations.AddField(model_name="client", name="workspace", field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="clients", to="accounts.workspace")),
    ]
