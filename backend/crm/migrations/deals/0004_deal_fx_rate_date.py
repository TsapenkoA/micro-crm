from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('deals', '0003_require_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='deal',
            name='fx_rate_date',
            field=models.DateField(blank=True, null=True),
        ),
    ]
