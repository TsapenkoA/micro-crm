from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("deals", "0004_deal_fx_rate_date"),
        ("invoices", "0006_invoice_fx_rate_date"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="deal",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="invoices", to="deals.deal"),
        ),
    ]
