from decimal import Decimal, ROUND_HALF_UP

from django.db import migrations, models
from django.db.models import F


def preserve_existing_invoices(apps, schema_editor):
    Invoice = apps.get_model("invoices", "Invoice")
    InvoiceItem = apps.get_model("invoices", "InvoiceItem")
    Invoice.objects.using(schema_editor.connection.alias).update(updated_at=F("created_at"))
    items = InvoiceItem.objects.using(schema_editor.connection.alias).select_related("invoice")
    positions = {}
    for item in items.iterator():
        if item.quantity <= 0 or not Decimal("0") <= item.invoice.tax_rate <= Decimal("100"):
            raise RuntimeError("Existing invoice items need review before applying the financial constraints.")
        item.tax_rate = item.invoice.tax_rate
        item.tax_amount = (item.line_total * item.tax_rate / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        item.position = positions.get(item.invoice_id, 0)
        positions[item.invoice_id] = item.position + 1
        item.save(update_fields=["tax_rate", "tax_amount", "position"])


class Migration(migrations.Migration):
    dependencies = [("invoices", "0003_require_workspace")]

    operations = [
        migrations.AddField(model_name="invoice", name="issued_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="invoice", name="updated_at", field=models.DateTimeField(auto_now=True, null=True)),
        migrations.AddField(model_name="invoiceitem", name="tax_rate", field=models.DecimalField(decimal_places=4, default=0, max_digits=7)),
        migrations.AddField(model_name="invoiceitem", name="tax_amount", field=models.DecimalField(decimal_places=4, default=0, max_digits=20)),
        migrations.AddField(model_name="invoiceitem", name="position", field=models.PositiveIntegerField(default=0)),
        migrations.AlterField(model_name="invoice", name="subtotal", field=models.DecimalField(decimal_places=4, default=0, max_digits=20)),
        migrations.AlterField(model_name="invoice", name="tax_total", field=models.DecimalField(decimal_places=4, default=0, max_digits=20)),
        migrations.AlterField(model_name="invoice", name="total_amount", field=models.DecimalField(decimal_places=4, default=0, max_digits=20)),
        migrations.AlterField(model_name="invoiceitem", name="unit_price", field=models.DecimalField(decimal_places=4, max_digits=20)),
        migrations.AlterField(model_name="invoiceitem", name="line_total", field=models.DecimalField(decimal_places=4, max_digits=20)),
        migrations.AlterModelOptions(name="invoiceitem", options={"ordering": ["position", "id"]}),
        migrations.RunPython(preserve_existing_invoices, migrations.RunPython.noop),
    ]
