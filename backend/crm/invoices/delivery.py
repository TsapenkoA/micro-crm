from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMessage
from django.core.validators import validate_email
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from crm.models import InvoiceDelivery
from crm.services.calculations import money_string
from crm.services.pdf import render_invoice


class MailUnavailable(APIException):
    status_code = 503
    default_detail = "Invoice email is unavailable. Check email configuration and try again."


class DeliveryConflict(APIException):
    status_code = 409
    default_detail = "This email was already accepted by the mail server."


def recipient_for(invoice):
    recipient = (invoice.buyer_snapshot.get("email") or "").strip()
    try:
        validate_email(recipient)
    except DjangoValidationError as exc:
        raise ValidationError({"recipient": "The invoice has no valid client email address."}) from exc
    return recipient


def reminder_copy(invoice):
    outstanding = invoice.total_amount - sum((payment.amount for payment in invoice.payments.all()), 0)
    name = invoice.buyer_snapshot.get("name") or invoice.buyer_snapshot.get("company") or "there"
    subject = f"Payment reminder: {invoice.invoice_number}"
    body = (
        f"Hello {name},\n\n"
        f"This is a reminder that invoice {invoice.invoice_number} was due on {invoice.due_date.isoformat()}. "
        f"Our records show {money_string(outstanding, invoice.currency)} {invoice.currency} outstanding.\n\n"
        "If you have already paid, please disregard this reminder or reply with the payment details.\n\n"
        f"Thank you,\n{invoice.seller_snapshot.get('name') or 'Your supplier'}"
    )
    return subject, body


def reminder_blocker(invoice):
    if invoice.status != invoice.Status.SENT:
        return "Only unpaid sent invoices can receive reminders."
    if invoice.due_date is None or invoice.due_date >= timezone.localdate():
        return "The invoice is not overdue."
    if invoice.total_amount <= sum((payment.amount for payment in invoice.payments.all()), 0):
        return "The invoice has no outstanding balance."
    latest = invoice.deliveries.filter(kind=InvoiceDelivery.Kind.REMINDER, result=InvoiceDelivery.Result.ACCEPTED).first()
    if latest and latest.attempted_at > timezone.now() - timedelta(days=7):
        return "A reminder was already sent within the last seven days."
    return ""


def send_invoice_email(invoice, actor, kind):
    if settings.EMAIL_BACKEND not in {
        "django.core.mail.backends.smtp.EmailBackend",
        "django.core.mail.backends.locmem.EmailBackend",
    }:
        raise MailUnavailable()
    recipient = recipient_for(invoice)
    if kind == InvoiceDelivery.Kind.REMINDER:
        subject, body = reminder_copy(invoice)
    else:
        subject = f"Invoice {invoice.invoice_number} from {invoice.seller_snapshot.get('name') or 'your supplier'}"
        body = (
            f"Hello {invoice.buyer_snapshot.get('name') or 'there'},\n\n"
            f"Please find invoice {invoice.invoice_number} attached. "
            f"The total is {money_string(invoice.total_amount, invoice.currency)} {invoice.currency}, "
            f"due {invoice.due_date.isoformat() if invoice.due_date else 'as agreed'}.\n\n"
            f"Thank you,\n{invoice.seller_snapshot.get('name') or 'Your supplier'}"
        )
    message = EmailMessage(subject, body, settings.DEFAULT_FROM_EMAIL, [recipient])
    message.attach(f"{invoice.invoice_number}.pdf", render_invoice(invoice), "application/pdf")
    try:
        accepted = message.send(fail_silently=False)
    except Exception:
        accepted = 0
    delivery = InvoiceDelivery.objects.create(
        invoice=invoice, requested_by=actor, kind=kind, recipient=recipient,
        result=InvoiceDelivery.Result.ACCEPTED if accepted == 1 else InvoiceDelivery.Result.FAILED,
    )
    return delivery
