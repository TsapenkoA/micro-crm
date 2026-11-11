from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0008_workspace_bank_details"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserAvatar",
            fields=[
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name="crm_avatar", serialize=False, to=settings.AUTH_USER_MODEL)),
                ("image", models.BinaryField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
