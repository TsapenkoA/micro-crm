from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0007_alter_workspacemembership_reporting_currency")]

    operations = [migrations.AddField(model_name="workspace", name="bank_details", field=models.JSONField(blank=True, default=dict))]
