from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0011_pendingsignup")]

    operations = [
        migrations.CreateModel(
            name="FxSyncRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("started_at", models.DateTimeField(auto_now_add=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("status", models.CharField(choices=[("running", "Running"), ("success", "Success"), ("failed", "Failed")], default="running", max_length=7)),
                ("latest_rate_date", models.DateField(blank=True, null=True)),
                ("imported_count", models.PositiveIntegerField(default=0)),
                ("error", models.CharField(blank=True, max_length=200)),
            ],
        ),
    ]
