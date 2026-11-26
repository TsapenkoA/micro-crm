import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_authattempt'),
    ]

    operations = [
        migrations.CreateModel(
            name='PreviewDataset',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('payload', models.JSONField(default=dict)),
                ('workspace', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='preview_dataset', to='accounts.workspace')),
            ],
            options={
                'abstract': False,
            },
        ),
    ]
