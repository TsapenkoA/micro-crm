import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import crm.fields
from crm.services import data_protection


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0015_pending_email_change'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='previewdataset',
            name='payload',
            field=crm.fields.EncryptedJSONField(default=dict),
        ),
        migrations.AlterField(
            model_name='useravatar',
            name='image',
            field=crm.fields.EncryptedBinaryField(),
        ),
        migrations.AlterField(
            model_name='workspace',
            name='bank_details',
            field=crm.fields.EncryptedJSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name='workspace',
            name='seller_details',
            field=crm.fields.EncryptedJSONField(blank=True, default=dict),
        ),
        migrations.CreateModel(
            name='WorkspaceJoinRequest',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('expires_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('requested_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sent_workspace_requests', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='workspace_requests', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='join_requests', to='accounts.workspace')),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('workspace', 'user'), name='workspace_join_request_unique')],
            },
        ),
        migrations.RunPython(data_protection.accounts_forward, data_protection.accounts_reverse),
    ]
