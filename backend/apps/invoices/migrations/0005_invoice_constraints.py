from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [("invoices", "0004_invoice_calculations")]

    operations = [
        migrations.AlterField(model_name="invoice", name="updated_at", field=models.DateTimeField(auto_now=True)),
        migrations.RemoveConstraint(model_name="invoiceitem", name="invoice_item_values_nonnegative"),
        migrations.AddConstraint(model_name="invoiceitem", constraint=models.CheckConstraint(condition=Q(quantity__gt=0) & Q(unit_price__gte=0) & Q(line_total__gte=0) & Q(tax_rate__gte=0) & Q(tax_rate__lte=100) & Q(tax_amount__gte=0), name="invoice_item_values_valid")),
    ]
