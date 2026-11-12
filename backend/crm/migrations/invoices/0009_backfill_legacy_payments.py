from django.db import migrations
from django.utils import timezone


def backfill_payments(apps, schema_editor):
    Invoice = apps.get_model("invoices", "Invoice")
    InvoicePayment = apps.get_model("invoices", "InvoicePayment")
    payments = []
    for invoice in Invoice.objects.filter(status="paid", total_amount__gt=0).iterator():
        payments.append(InvoicePayment(
            invoice_id=invoice.pk,
            recorded_by_id=invoice.created_by_id,
            amount=invoice.total_amount,
            received_on=timezone.localtime(invoice.paid_at).date(),
            fx_rate_date=invoice.fx_rate_date,
            is_legacy=True,
        ))
    InvoicePayment.objects.bulk_create(payments)


class Migration(migrations.Migration):
    dependencies = [("invoices", "0008_invoicedelivery_invoicepayment_and_more")]

    operations = [migrations.RunPython(backfill_payments, migrations.RunPython.noop)]
