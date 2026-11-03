from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_migrate_workspace_data"), ("clients", "0002_workspace")]
    operations = [
        migrations.AlterField(model_name="client", name="workspace", field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="clients", to="accounts.workspace")),
    ]
