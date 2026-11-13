from datetime import date, datetime
from decimal import Decimal

from crm.models import ActivityEvent, Client, Deal, Invoice, Task
from crm.services.calculations import money_string


FIELDS = {
    Client: ("name", "company"),
    Deal: ("title", "status", "amount", "currency", "deadline"),
    Task: ("title", "status", "assignee", "due_at"),
    Invoice: ("status", "total_amount", "currency", "due_date", "deal_id"),
}
TYPES = {Client: "client", Deal: "deal", Task: "task", Invoice: "invoice"}


def snapshot(instance):
    values = {}
    for field in FIELDS[type(instance)]:
        value = getattr(instance, field)
        if field == "assignee":
            value = value.username if value else None
        elif field == "total_amount":
            value = money_string(value, instance.currency)
        elif isinstance(value, (Decimal, date, datetime)):
            value = str(value) if isinstance(value, Decimal) else value.isoformat()
        elif value is not None and not isinstance(value, (str, int, float, bool)):
            value = str(value)
        values[field] = value
    return values


def log_activity(instance, actor, action, before=None, details=None):
    after = snapshot(instance)
    changes = {field: {"from": old, "to": after[field]} for field, old in before.items() if old != after[field]} if before is not None else {}
    if details:
        changes.update(details)
    if action == "updated" and not changes:
        return None
    label = instance.invoice_number if isinstance(instance, Invoice) else instance.title if isinstance(instance, (Deal, Task)) else instance.name
    return ActivityEvent.objects.create(
        workspace_id=instance.workspace_id, actor=actor,
        actor_name=actor.get_full_name().strip() or actor.username,
        entity_type=TYPES[type(instance)], entity_id=instance.pk,
        entity_label=label, action=action, changes=changes,
    )
