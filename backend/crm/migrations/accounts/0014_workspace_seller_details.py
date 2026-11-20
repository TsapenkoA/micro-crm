from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0013_backup_check'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspace',
            name='seller_details',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
