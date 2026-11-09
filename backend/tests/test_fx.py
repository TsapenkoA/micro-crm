from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone

import pytest

from crm.models import Client, Deal, FxRate, Invoice, WorkspaceMembership
from crm.services.fx import convert, rate_date_for


pytestmark = pytest.mark.django_db
URL = "/api/v1/analytics/dashboard"


def rate(day, currency, value):
    return FxRate.objects.create(date=day, currency=currency, per_eur=Decimal(value))


def test_reporting_currency_is_personal_and_persists(api, user, other_user):
    api.force_login(user)
    assert api.get("/api/v1/auth/me").json()["user"]["reporting_currency"] == "USD"
    api.credentials(HTTP_X_CSRFTOKEN=api.get("/api/v1/auth/csrf").json()["csrfToken"])
    response = api.patch("/api/v1/auth/reporting-currency", {"reporting_currency": "EUR"}, format="json")
    assert response.status_code == 200
    assert api.get("/api/v1/auth/me").json()["user"]["reporting_currency"] == "EUR"
    assert WorkspaceMembership.objects.get(user=other_user).reporting_currency == "USD"
    assert api.patch("/api/v1/auth/reporting-currency", {"reporting_currency": "GBP"}, format="json").status_code == 200
    assert WorkspaceMembership.objects.get(user=user).reporting_currency == "GBP"
    assert api.patch("/api/v1/auth/reporting-currency", {"reporting_currency": "UAH"}, format="json").status_code == 400
    assert WorkspaceMembership.objects.get(user=user).reporting_currency == "GBP"


def test_cross_rates_and_historical_dashboard(api, user, other_user, client_record):
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)
    for day, usd, gbp, pln, jpy in ((yesterday, "1.10", "0.55", "4.00", "140"), (today, "1.20", "0.80", "4.20", "150")):
        rate(day, "USD", usd)
        rate(day, "GBP", gbp)
        rate(day, "PLN", pln)
        rate(day, "JPY", jpy)
    workspace = client_record.workspace
    Deal.objects.create(workspace=workspace, created_by=user, client=client_record, title="Active", amount=Decimal("100"), currency="GBP")
    Deal.objects.create(workspace=workspace, created_by=user, client=client_record, title="Paid", status="paid", amount=Decimal("100"), currency="PLN", paid_at=timezone.now(), fx_rate_date=yesterday)
    Invoice.objects.create(workspace=workspace, created_by=user, client=client_record, invoice_number="GBP-1", status="paid", currency="GBP", total_amount=Decimal("100"), paid_at=timezone.now(), fx_rate_date=yesterday)
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign")
    Invoice.objects.create(workspace=foreign.workspace, created_by=other_user, client=foreign, invoice_number="GBP-2", status="paid", currency="GBP", total_amount=Decimal("999"), paid_at=timezone.now(), fx_rate_date=yesterday)
    api.force_login(user)
    usd = api.get(URL).json()
    assert (usd["pipeline_value"], usd["average_deal_size"], usd["revenue"], usd["win_rate"]) == ("150.00", "27.50", "200.00", "100.00")
    assert usd["fx"]["pipeline_rate_date"] == today.isoformat()
    assert usd["fx"]["revenue_rate_dates"] == [yesterday.isoformat()]
    assert usd["recent_deals"][0]["currency"] == "GBP"
    eur = api.get(URL + "?currency=EUR").json()
    assert (eur["pipeline_value"], eur["average_deal_size"], eur["revenue"]) == ("125.00", "25.00", "181.82")
    gbp = api.get(URL + "?currency=GBP").json()
    assert (gbp["pipeline_value"], gbp["average_deal_size"], gbp["revenue"]) == ("100.00", "13.75", "100.00")
    jpy = api.get(URL + "?currency=JPY").json()
    assert (jpy["pipeline_value"], jpy["average_deal_size"], jpy["revenue"]) == ("18750", "3500", "25455")


def test_missing_or_stale_rates_never_return_partial_totals(api, user, client_record):
    workspace = client_record.workspace
    Deal.objects.create(workspace=workspace, created_by=user, client=client_record, title="Priced in GBP", amount=Decimal("100"), currency="GBP")
    Deal.objects.create(workspace=workspace, created_by=user, client=client_record, title="Priced in USD", amount=Decimal("10"), currency="USD")
    Invoice.objects.create(workspace=workspace, created_by=user, client=client_record, invoice_number="PLN-1", status="paid", currency="PLN", total_amount=Decimal("100"), paid_at=timezone.now())
    old = timezone.localdate() - timedelta(days=10)
    rate(old, "USD", "1.2")
    rate(old, "GBP", "0.8")
    api.force_login(user)
    data = api.get(URL).json()
    assert data["pipeline_value"] is None and data["revenue"] is None
    assert data["fx"]["missing"] == {"pipeline": ["GBP"], "average_deal_size": [], "revenue": ["PLN"]}
    assert data["revenue_rows"][-1]["revenue"] is None
    assert data["deal_counts"] == [{"status": "new_lead", "count": 2}]


def test_rate_import_is_idempotent_and_never_rewrites_history(monkeypatch):
    day = timezone.localdate()
    header = "FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\n"
    content = f"{header}D,USD,EUR,{day},1.20\nD,GBP,EUR,{day},0.80\n".encode()
    monkeypatch.setattr("crm.management.commands.sync_fx_rates.urlopen", lambda *args, **kwargs: BytesIO(content))
    call_command("sync_fx_rates", since=day.isoformat(), until=day.isoformat())
    call_command("sync_fx_rates", since=day.isoformat(), until=day.isoformat())
    assert FxRate.objects.count() == 2
    monkeypatch.setattr("crm.management.commands.sync_fx_rates.urlopen", lambda *args, **kwargs: BytesIO(content.replace(b"1.20", b"1.30")))
    with pytest.raises(CommandError, match="stored rates differ"):
        call_command("sync_fx_rates", since=day.isoformat(), until=day.isoformat())
    assert FxRate.objects.get(currency="USD").per_eur == Decimal("1.20")
    stored = FxRate.objects.get(currency="USD")
    stored.per_eur = Decimal("1.40")
    with pytest.raises(DjangoValidationError, match="cannot be changed"):
        stored.save()


def test_paid_records_receive_and_keep_rate_dates(api, user, client_record):
    day = timezone.localdate()
    rate(day, "USD", "1.20")
    rate(day, "GBP", "0.80")
    api.force_login(user)
    api.credentials(HTTP_X_CSRFTOKEN=api.get("/api/v1/auth/csrf").json()["csrfToken"])
    deal = api.post("/api/v1/deals", {"title": "Project", "client": str(client_record.pk), "amount": "100.00", "currency": "GBP", "status": "paid"}, format="json")
    assert deal.status_code == 201, deal.json()
    assert deal.json()["fx_rate_date"] == day.isoformat()
    draft = api.post("/api/v1/invoices", {"client": str(client_record.pk), "currency": "GBP", "items": [{"description": "Service", "quantity": "1", "unit_price": "100", "tax_rate": "0"}]}, format="json")
    assert draft.status_code == 201, draft.json()
    path = f"/api/v1/invoices/{draft.json()['id']}/status"
    assert api.patch(path, {"status": "sent"}, format="json").status_code == 200
    paid = api.patch(path, {"status": "paid"}, format="json")
    assert paid.status_code == 200 and paid.json()["fx_rate_date"] == day.isoformat()
    assert api.get(URL).json()["revenue"] == "150.00"
    assert convert(Decimal("100"), "GBP", "USD", day) == Decimal("150.00")
    assert rate_date_for("GBP", day) == day


def test_backfill_preserves_existing_paid_amounts(user, client_record):
    day = timezone.localdate()
    rate(day, "USD", "1.20")
    rate(day, "PLN", "4.00")
    invoice = Invoice.objects.create(
        workspace=client_record.workspace, created_by=user, client=client_record,
        invoice_number="OLD-1", status="paid", currency="PLN",
        total_amount=Decimal("100.00"), paid_at=timezone.now(),
    )
    call_command("snapshot_fx_rates")
    invoice.refresh_from_db()
    assert invoice.fx_rate_date == day
    assert invoice.total_amount == Decimal("100.00")
    call_command("snapshot_fx_rates")
    assert Invoice.objects.get(pk=invoice.pk).fx_rate_date == day
