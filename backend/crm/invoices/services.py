import re
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from crm.models import Invoice
from crm.models import InvoicePayment
from crm.services.calculations import money_string, round_money
from crm.services.fx import rate_date_for


def buyer_snapshot(client):
    snapshot = {"name": client.name, "company": client.company, "email": client.email, "phone": client.phone}
    if client.bank_details:
        snapshot["bank_details"] = client.bank_details
    return snapshot


def invoice_number(workspace_id):
    numbers = Invoice.objects.filter(workspace_id=workspace_id).values_list("invoice_number", flat=True)
    sequence = max((int(match.group(1)) for number in numbers if (match := re.fullmatch(r"INV-(\d+)", number))), default=0)
    return f"INV-{sequence + 1:06d}"


def recorded_total(invoice):
    return sum((payment.amount for payment in invoice.payments.all()), Decimal("0"))


def record_payment(invoice, user, amount, received_on, reference=""):
    if invoice.status != Invoice.Status.SENT:
        raise ValidationError({"status": "Only sent invoices can receive payments."})
    if received_on > timezone.localdate():
        raise ValidationError({"received_on": "Payment date cannot be in the future."})
    if amount != round_money(amount, invoice.currency):
        raise ValidationError({"amount": "Use the precision of the invoice currency."})
    remaining = invoice.total_amount - recorded_total(invoice)
    if amount > remaining:
        raise ValidationError({"amount": "Payment exceeds the outstanding balance."})
    payment = InvoicePayment.objects.create(
        invoice=invoice, recorded_by=user, amount=amount, received_on=received_on,
        reference=reference, fx_rate_date=rate_date_for(invoice.currency, received_on),
    )
    if amount == remaining:
        invoice.status = Invoice.Status.PAID
        invoice.paid_at = timezone.now()
        invoice.fx_rate_date = payment.fx_rate_date
        invoice.save()
    return payment


def issue_invoice(invoice):
    if invoice.status == Invoice.Status.DRAFT:
        today = timezone.localdate()
        if invoice.due_date and invoice.due_date < today:
            raise ValidationError({"due_date": "Due date cannot precede the issue date."})
        invoice.status = Invoice.Status.SENT
        invoice.issued_at = timezone.now()
        if invoice.due_date is None:
            invoice.due_date = today + timedelta(days=30)
            if not invoice.payment_terms:
                invoice.payment_terms = "Payment due within 30 days of issue."
        invoice.save()
