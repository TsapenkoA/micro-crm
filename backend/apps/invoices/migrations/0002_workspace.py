from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial"), ("invoices", "0001_initial")]
    operations = [
        migrations.RemoveConstraint(model_name="invoice", name="invoice_owner_number_unique"),
        migrations.RenameField(model_name="invoice", old_name="owner", new_name="created_by"),
        migrations.AddField(model_name="invoice", name="workspace", field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="invoices", to="accounts.workspace")),
    ]
