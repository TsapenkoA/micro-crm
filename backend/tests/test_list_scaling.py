from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from crm.models import (
    Client,
    Deal,
    Invoice,
    InvoiceDelivery,
    InvoiceDueDateCorrection,
    InvoicePayment,
)

pytestmark = pytest.mark.django_db


def test_deal_pages_keep_full_workspace_totals_and_stable_order(api, user, other_user, client_record):
    for title in ("Zeta", "Alpha", "Beta"):
        Deal.objects.create(workspace=client_record.workspace, client=client_record, created_by=user,
                            title=title, amount=Decimal("100"), currency="USD")
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign")
    Deal.objects.create(workspace=foreign.workspace, client=foreign, created_by=other_user,
                        title="Foreign", amount=Decimal("999"), currency="USD")
    api.force_login(user)
    first = api.get("/api/v1/deals", {"ordering": "title", "page_size": 2, "page": 1}).json()
    second = api.get("/api/v1/deals", {"ordering": "title", "page_size": 2, "page": 2}).json()
    assert first["count"] == second["count"] == 3
    assert [row["title"] for row in first["results"] + second["results"]] == ["Alpha", "Beta", "Zeta"]
    assert first["totals"] == second["totals"] == [{"status": "new_lead", "currency": "USD", "count": 3, "amount": "300.00"}]
    assert api.get("/api/v1/deals", {"ordering": "invalid"}).status_code == 400


def test_invoice_summary_uses_all_pages_and_excludes_other_workspaces(api, user, other_user, client_record):
    today = timezone.localdate()
    invoices = []
    for number, status, due in ((1, "sent", today - timedelta(days=1)), (2, "sent", today + timedelta(days=1)), (3, "draft", None)):
        invoices.append(Invoice.objects.create(workspace=client_record.workspace, client=client_record, created_by=user,
                                               invoice_number=f"SUMMARY-{number}", status=status, currency="USD",
                                               total_amount=Decimal("100"), due_date=due))
    InvoicePayment.objects.create(invoice=invoices[0], recorded_by=user, amount=Decimal("40"), received_on=today)
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign")
    Invoice.objects.create(workspace=foreign.workspace, client=foreign, created_by=other_user,
                           invoice_number="FOREIGN", currency="USD", total_amount=Decimal("999"))
    api.force_login(user)
    with CaptureQueriesContext(connection) as captured:
        page = api.get("/api/v1/invoices", {"page_size": 1}).json()
    for model in (InvoicePayment, InvoiceDelivery, InvoiceDueDateCorrection):
        assert not any(model._meta.db_table in query["sql"] for query in captured.captured_queries)
    summary = api.get("/api/v1/invoices/summary", {"currency": "USD"}).json()
    assert page["count"] == 3 and len(page["results"]) == 1
    assert summary == {"currency": "USD", "sent": {"count": 2, "amount": "160.00"},
                       "paid": {"count": 1, "amount": "40.00"}, "draft": {"count": 1, "amount": "100.00"},
                       "overdue": {"count": 1, "amount": "60.00"}}
    assert api.get("/api/v1/invoices/summary", {"currency": "XYZ"}).status_code == 400
