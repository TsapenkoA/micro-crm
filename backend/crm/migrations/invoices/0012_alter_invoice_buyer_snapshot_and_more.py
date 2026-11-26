from django.db import migrations

import crm.fields
from crm.services import data_protection


class Migration(migrations.Migration):

    dependencies = [
        ('invoices', '0011_invoicedelivery_resolution_reason_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='invoice',
            name='buyer_snapshot',
            field=crm.fields.EncryptedJSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name='invoice',
            name='seller_snapshot',
            field=crm.fields.EncryptedJSONField(blank=True, default=dict),
        ),
        migrations.RunPython(data_protection.invoices_forward, data_protection.invoices_reverse),
    ]
