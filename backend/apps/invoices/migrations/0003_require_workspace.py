from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_migrate_workspace_data"), ("invoices", "0002_workspace")]
    operations = [
        migrations.AlterField(model_name="invoice", name="workspace", field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="invoices", to="accounts.workspace")),
        migrations.AddConstraint(model_name="invoice", constraint=models.UniqueConstraint(fields=("workspace", "invoice_number"), name="invoice_workspace_number_unique")),
    ]
