from datetime import datetime
from decimal import Decimal

from django.utils import timezone

import pytest

from crm.models import Client, Deal, FxRate, Invoice

pytestmark = pytest.mark.django_db


URL = "/api/v1/analytics/dashboard"


def deal(user, client, status, amount, currency="USD", outcome="none"):
    return Deal.objects.create(
        workspace=client.workspace, created_by=user, client=client, title="Project",
        status=status, amount=Decimal(amount), currency=currency, outcome=outcome,
        paid_at=timezone.now() if status == "paid" else None,
        fx_rate_date=timezone.localdate() if status == "paid" else None,
    )


def invoice(user, client, amount, currency="USD", paid_at=None):
    return Invoice.objects.create(
        workspace=client.workspace, created_by=user, client=client,
        invoice_number=f"INV-{Invoice.objects.count() + 1}", currency=currency,
        status="paid", paid_at=paid_at or timezone.now(), fx_rate_date=timezone.localtime(paid_at).date() if paid_at else timezone.localdate(), total_amount=Decimal(amount),
    )


def test_empty_dashboard_and_validation(api, user):
    assert api.get(URL).status_code == 403
    api.force_login(user)
    data = api.get(URL).json()
    assert data["pipeline_value"] == "0.00"
    assert data["revenue"] == "0.00"
    assert data["win_rate"] is None and data["average_deal_size"] is None
    assert len(data["revenue_rows"]) == 12
    assert all(row["revenue"] == "0.00" for row in data["revenue_rows"])
    assert len(api.get(URL + "?period=quarter").json()["revenue_rows"]) == 8
    assert api.get(URL + "?currency=INVALID").status_code == 400
    assert api.get(URL + "?period=week").status_code == 400


def test_currency_workspace_and_revenue_source(api, user, other_user, client_record):
    FxRate.objects.create(date=timezone.localdate(), currency="USD", per_eur=Decimal("1.2"))
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign")
    deal(user, client_record, "new_lead", "40.00")
    deal(user, client_record, "paid", "30.00")
    deal(user, client_record, "archived", "10.00", outcome="lost")
    deal(user, client_record, "archived", "10.00", outcome="cancelled")
    deal(user, client_record, "new_lead", "99.00", currency="EUR")
    deal(other_user, foreign, "paid", "999.00")
    invoice(user, client_record, "12.50")
    invoice(other_user, foreign, "900.00")
    api.force_login(user)
    data = api.get(URL).json()
    assert (data["pipeline_value"], data["win_rate"], data["average_deal_size"], data["revenue"]) == ("158.80", "50.00", "30.00", "12.50")
    assert sum(Decimal(row["revenue"]) for row in data["revenue_rows"]) == Decimal("12.50")
    assert data["recent_deals"][0]["client__name"] == client_record.name
    eur = api.get(URL + "?currency=EUR").json()
    assert (eur["pipeline_value"], eur["revenue"], eur["average_deal_size"], eur["win_rate"]) == ("132.33", "10.42", "25.00", "50.00")
    assert eur["fx"]["source"] == "ECB" and eur["fx"]["pipeline_rate_date"] == timezone.localdate().isoformat()


def test_period_boundaries_and_precision(api, user, client_record):
    now = timezone.localtime()
    this_month = timezone.make_aware(datetime(now.year, now.month, 1))
    previous_month = this_month - timezone.timedelta(days=1)
    invoice(user, client_record, "2.12", "USD", this_month)
    invoice(user, client_record, "3.45", "USD", previous_month)
    api.force_login(user)
    data = api.get(URL + "?currency=USD&period=month").json()
    assert data["revenue"] == "5.57"
    assert data["revenue_rows"][-1]["revenue"] == "2.12"
    quarter = api.get(URL + "?currency=USD&period=quarter").json()
    assert quarter["revenue"] == "5.57"
