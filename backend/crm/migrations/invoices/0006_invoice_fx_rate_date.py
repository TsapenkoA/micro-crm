from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0005_invoice_constraints'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='fx_rate_date',
            field=models.DateField(blank=True, null=True),
        ),
    ]
