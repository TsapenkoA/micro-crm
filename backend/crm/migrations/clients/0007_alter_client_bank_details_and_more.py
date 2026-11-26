from django.db import migrations

import crm.fields
from crm.services import data_protection


class Migration(migrations.Migration):

    dependencies = [
        ('clients', '0006_clientnote_deal'),
    ]

    operations = [
        migrations.AlterField(
            model_name='client',
            name='bank_details',
            field=crm.fields.EncryptedJSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name='clientattachment',
            name='content',
            field=crm.fields.EncryptedBinaryField(),
        ),
        migrations.RunPython(data_protection.clients_forward, data_protection.clients_reverse),
    ]
