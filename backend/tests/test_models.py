import uuid
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone

from apps.clients.models import ClientLink, ClientNote
from apps.deals.models import Deal
from apps.invoices.models import Invoice, InvoiceItem

pytestmark = pytest.mark.django_db


def make_deal(user, client, **fields):
    return Deal.objects.create(workspace=user.workspace_membership.workspace, created_by=user, client=client, title="Design", amount=Decimal("1500.25"), currency="USD", **fields)


def make_invoice(user, client, **fields):
    return Invoice.objects.create(workspace=user.workspace_membership.workspace, created_by=user, client=client, invoice_number="INV-001", currency="EUR", **fields)


def test_models_preserve_uuid_decimal_and_relations(user, client_record):
    note = ClientNote.objects.create(client=client_record, author=user, text="Kickoff")
    link = ClientLink.objects.create(client=client_record, label="Brief", url="https://example.com/brief")
    deal = make_deal(user, client_record)
    invoice = make_invoice(user, client_record, buyer_snapshot={"name": "Acme"})
    item = InvoiceItem.objects.create(invoice=invoice, description="Design", quantity=Decimal("1.250"), unit_price=Decimal("12.34"), line_total=Decimal("15.43"))
    for obj in [client_record, note, link, deal, invoice, item]:
        obj.refresh_from_db()
        assert isinstance(obj.pk, uuid.UUID)
    assert deal.amount == Decimal("1500.25")
    assert item.quantity == Decimal("1.250")
    assert deal.version == 1
    assert timezone.is_aware(deal.created_at)
    assert list(client_record.notes.all()) == [note]
    assert list(invoice.items.all()) == [item]
    client_record.name = "Renamed"
    client_record.save()
    invoice.refresh_from_db()
    assert invoice.buyer_snapshot == {"name": "Acme"}


@pytest.mark.parametrize("model", ["deal", "invoice", "note"])
def test_cross_workspace_relations_rejected(model, user, other_user, client_record):
    with pytest.raises(ValidationError):
        if model == "deal":
            make_deal(other_user, client_record)
        elif model == "invoice":
            make_invoice(other_user, client_record)
        else:
            ClientNote.objects.create(client=client_record, author=other_user, text="Forbidden")


@pytest.mark.parametrize("changes", [
    {"amount": Decimal("-0.01")}, {"version": 0}, {"currency": "usd"},
    {"status": "invalid"}, {"outcome": "lost"}, {"status": "paid"},
    {"paid_at": timezone.now()},
])
def test_deal_constraints(user, client_record, changes):
    deal = Deal(workspace=user.workspace_membership.workspace, created_by=user, client=client_record, title="Test", amount=1, currency="EUR")
    for field, value in changes.items():
        setattr(deal, field, value)
    with pytest.raises(ValidationError):
        deal.save()


def test_archived_outcome_and_paid_timestamp(user, client_record):
    assert make_deal(user, client_record, status="archived", outcome="lost").outcome == "lost"
    assert make_deal(user, client_record, status="paid", paid_at=timezone.now()).paid_at is not None


def test_database_rejects_negative_amount_on_bulk_update(user, client_record):
    deal = make_deal(user, client_record)
    with pytest.raises(IntegrityError), transaction.atomic():
        Deal.objects.filter(pk=deal.pk).update(amount=-1)


def test_invoice_number_unique_per_workspace(user, other_user, client_record):
    from apps.clients.models import Client

    make_invoice(user, client_record)
    with pytest.raises(ValidationError):
        make_invoice(user, client_record)
    other_client = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Other")
    assert make_invoice(other_user, other_client).invoice_number == "INV-001"


@pytest.mark.parametrize("field", ["tax_rate", "subtotal", "tax_total", "total_amount"])
def test_invoice_disallows_negative_values(user, client_record, field):
    with pytest.raises(ValidationError):
        make_invoice(user, client_record, **{field: Decimal("-0.01")})


@pytest.mark.parametrize("field", ["quantity", "unit_price", "line_total"])
def test_invoice_item_disallows_negative_values(user, client_record, field):
    invoice = make_invoice(user, client_record)
    values = {"quantity": 1, "unit_price": 1, "line_total": 1, field: -1}
    with pytest.raises(ValidationError):
        InvoiceItem.objects.create(invoice=invoice, description="Item", **values)


def test_deletion_protects_client_and_invoice_items(user, client_record):
    invoice = make_invoice(user, client_record)
    InvoiceItem.objects.create(invoice=invoice, description="Item", quantity=1, unit_price=1, line_total=1)
    with pytest.raises(ProtectedError):
        client_record.delete()
    with pytest.raises(ProtectedError):
        invoice.delete()
