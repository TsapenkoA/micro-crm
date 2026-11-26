from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0016_alter_previewdataset_payload_alter_useravatar_image_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="time_zone",
            field=models.CharField(default="UTC", max_length=64),
        ),
    ]
