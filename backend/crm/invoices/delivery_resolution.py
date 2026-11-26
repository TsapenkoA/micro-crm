from django.db import transaction
from django.utils import timezone

from crm.models import InvoiceDelivery


@transaction.atomic
def resolve_invoice_delivery(delivery_id, outcome, operator, reason):
    reason = reason.strip()
    if outcome not in (InvoiceDelivery.Result.ACCEPTED, InvoiceDelivery.Result.FAILED):
        raise ValueError("Choose accepted or failed.")
    if not reason or len(reason) > 500:
        raise ValueError("Give a reason of 1 to 500 characters.")

    delivery = InvoiceDelivery.objects.select_for_update().filter(pk=delivery_id).first()
    if delivery is None:
        raise ValueError("Email attempt not found.")
    if delivery.result not in (InvoiceDelivery.Result.PENDING, InvoiceDelivery.Result.UNKNOWN) or delivery.resolved_at is not None:
        raise ValueError("Only an unresolved pending or unknown attempt can be resolved.")

    delivery.result = outcome
    delivery.resolved_at = timezone.now()
    delivery.resolved_by = operator
    delivery.resolution_reason = reason
    delivery.save(update_fields=["result", "resolved_at", "resolved_by", "resolution_reason"])
    return delivery
