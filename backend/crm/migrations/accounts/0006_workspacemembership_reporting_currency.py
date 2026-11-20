from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0005_fxrate'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspacemembership',
            name='reporting_currency',
            field=models.CharField(choices=[('USD', 'USD'), ('EUR', 'EUR')], default='USD', max_length=3),
        ),
    ]
