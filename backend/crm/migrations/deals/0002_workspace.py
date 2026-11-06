from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial"), ("deals", "0001_initial")]
    operations = [
        migrations.RenameField(model_name="deal", old_name="owner", new_name="created_by"),
        migrations.AddField(model_name="deal", name="workspace", field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="deals", to="accounts.workspace")),
    ]
