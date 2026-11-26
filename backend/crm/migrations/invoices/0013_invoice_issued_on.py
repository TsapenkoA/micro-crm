from datetime import timezone

from django.db import migrations, models


def backfill_issued_on(apps, schema_editor):
    invoice_model = apps.get_model("invoices", "Invoice")
    database = schema_editor.connection.alias
    batch = []
    for invoice in invoice_model.objects.using(database).filter(issued_at__isnull=False).only("pk", "issued_at").iterator():
        invoice.issued_on = invoice.issued_at.astimezone(timezone.utc).date()
        batch.append(invoice)
        if len(batch) == 1000:
            invoice_model.objects.using(database).bulk_update(batch, ["issued_on"])
            batch.clear()
    if batch:
        invoice_model.objects.using(database).bulk_update(batch, ["issued_on"])


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0012_alter_invoice_buyer_snapshot_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="issued_on",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_issued_on, migrations.RunPython.noop),
    ]
