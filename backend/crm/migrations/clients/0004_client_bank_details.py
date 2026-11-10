from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("clients", "0003_require_workspace")]

    operations = [migrations.AddField(model_name="client", name="bank_details", field=models.JSONField(blank=True, default=dict))]
