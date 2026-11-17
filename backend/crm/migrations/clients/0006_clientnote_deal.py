from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("clients", "0005_clientattachment_clientcontact"),
        ("deals", "0004_deal_fx_rate_date"),
    ]

    operations = [
        migrations.AddField(
            model_name="clientnote",
            name="deal",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="notes", to="deals.deal"),
        ),
    ]
