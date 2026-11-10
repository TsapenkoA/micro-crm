import re
from crm.models import Invoice


def buyer_snapshot(client):
    snapshot = {"name": client.name, "company": client.company, "email": client.email, "phone": client.phone}
    if client.bank_details:
        snapshot["bank_details"] = client.bank_details
    return snapshot


def invoice_number(workspace_id):
    numbers = Invoice.objects.filter(workspace_id=workspace_id).values_list("invoice_number", flat=True)
    sequence = max((int(match.group(1)) for number in numbers if (match := re.fullmatch(r"INV-(\d+)", number))), default=0)
    return f"INV-{sequence + 1:06d}"
