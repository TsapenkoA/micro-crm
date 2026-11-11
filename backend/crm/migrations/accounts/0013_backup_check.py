from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0012_fxsync_run")]

    operations = [
        migrations.CreateModel(
            name="BackupCheck",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("verified_at", models.DateTimeField(auto_now_add=True)),
                ("archive_bytes", models.PositiveBigIntegerField()),
            ],
        ),
    ]
