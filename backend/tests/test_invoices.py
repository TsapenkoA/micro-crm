from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from io import BytesIO
from threading import Barrier

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import close_old_connections

import pytest
from pypdf import PdfReader
from rest_framework.test import APIClient

from crm.models import Client, Invoice, InvoiceItem

pytestmark = pytest.mark.django_db


@pytest.fixture
def authenticated_api(api, user):
    api.force_login(user)
    api.credentials(HTTP_X_CSRFTOKEN=api.get("/api/v1/auth/csrf").json()["csrfToken"])
    return api


def item(description="Service", quantity="1.000", unit_price="10.00", tax_rate="0"):
    return {"description": description, "quantity": quantity, "unit_price": unit_price, "tax_rate": tax_rate}


def payload(client, **changes):
    return {"client": str(client.pk), "currency": "EUR", "items": [item()], **changes}


def create(api, client, **changes):
    return api.post("/api/v1/invoices", payload(client, **changes), format="json")


def test_create_calculates_lines_snapshots_and_persists(authenticated_api, user, client_record):
    response = create(authenticated_api, client_record, items=[item("No tax", "1", "10", "0"), item("Five percent", "2", "5", "5"), item("Twenty percent", "1", "10.005", "20")])
    assert response.status_code == 201, response.json()
    data = response.json()
    assert data["invoice_number"] == "INV-000001"
    assert data["status"] == "draft" and data["paid_at"] is None and data["issued_at"] is None
    assert [line["position"] for line in data["items"]] == [0, 1, 2]
    assert [line["line_total"] for line in data["items"]] == ["10.00", "10.00", "10.01"]
    assert [line["tax_amount"] for line in data["items"]] == ["0.00", "0.50", "2.00"]
    assert (data["subtotal"], data["tax_total"], data["total_amount"]) == ("30.01", "2.50", "32.51")
    assert data["buyer_snapshot"]["name"] == client_record.name
    assert data["seller_snapshot"]["name"] == user.workspace_membership.workspace.name
    saved = Invoice.objects.get(pk=data["id"])
    assert saved.workspace_id == user.workspace_membership.workspace_id and saved.created_by_id == user.pk
    assert saved.total_amount == Decimal("32.51")
    assert authenticated_api.get(f"/api/v1/invoices/{saved.pk}").json() == data


def test_pdf_contains_unicode_totals_and_multiple_pages(authenticated_api, client_record, other_user):
    descriptions = [f"Дизайн послуги {index} — звіт клієнта" for index in range(55)]
    created = create(authenticated_api, client_record, items=[item(description, "1", "10", "20") for description in descriptions])
    assert created.status_code == 201, created.json()
    invoice_id = created.json()["id"]
    response = authenticated_api.get(f"/api/v1/invoices/{invoice_id}/pdf")
    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"] == f'attachment; filename="{created.json()["invoice_number"]}.pdf"'
    reader = PdfReader(BytesIO(response.content))
    assert len(reader.pages) > 1
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert descriptions[0] in text and descriptions[-1] in text
    assert "20%" in text
    assert "660.00 USD" not in text
    assert "660.00 EUR" in text
    visitor = APIClient(enforce_csrf_checks=True)
    assert visitor.get(f"/api/v1/invoices/{invoice_id}/pdf").status_code == 403
    visitor.force_login(other_user)
    assert visitor.get(f"/api/v1/invoices/{invoice_id}/pdf").status_code == 404


@pytest.mark.parametrize("currency,unit_price,expected", [("JPY", "10.6", "11"), ("KWD", "10.1234", "10.123"), ("CLF", "10.1234", "10.1234"), ("USD", "10.005", "10.01")])
def test_currency_precision(authenticated_api, client_record, currency, unit_price, expected):
    response = create(authenticated_api, client_record, currency=currency, items=[item(unit_price=unit_price)])
    assert response.status_code == 201, response.json()
    assert response.json()["total_amount"] == expected


def test_draft_edit_recalculates_and_snapshots_remain_frozen_after_sending(authenticated_api, user, client_record):
    second = Client.objects.create(workspace=client_record.workspace, created_by=user, name="Second", email="second@example.test")
    invoice = create(authenticated_api, client_record).json()
    path = f"/api/v1/invoices/{invoice['id']}"
    assert authenticated_api.patch(path + "/status", {"status": "paid"}, format="json").status_code == 400
    response = authenticated_api.patch(path, {"client": str(second.pk), "items": [item("Updated", "3", "2.50", "20")]}, format="json")
    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["buyer_snapshot"]["name"] == "Second"
    assert data["total_amount"] == "9.00" and len(data["items"]) == 1
    second.name = "Renamed later"
    second.save()
    sent = authenticated_api.patch(path + "/status", {"status": "sent"}, format="json")
    assert sent.status_code == 200 and sent.json()["issued_at"] is not None
    assert sent.json()["buyer_snapshot"]["name"] == "Second"
    assert authenticated_api.patch(path, {"items": [item()]}, format="json").status_code == 400
    assert authenticated_api.delete(path).status_code == 405
    paid = authenticated_api.patch(path + "/status", {"status": "paid"}, format="json")
    assert paid.status_code == 200 and paid.json()["paid_at"] is not None
    assert paid.json()["buyer_snapshot"] == sent.json()["buyer_snapshot"]
    assert authenticated_api.patch(path + "/status", {"status": "sent"}, format="json").status_code == 400
    assert authenticated_api.get(path).json()["total_amount"] == "9.00"


@pytest.mark.parametrize("changes", [
    {"items": [item(quantity="0")]}, {"items": [item(quantity="-1")]},
    {"items": [item(unit_price="-1")]}, {"items": [item(tax_rate="101")]},
    {"items": [item(description=" ")]}, {"items": []},
    {"currency": "ZZZ"}, {"total_amount": "1.00"},
    {"invoice_number": "FAKE"}, {"status": "paid"},
    {"items": [dict(item(), line_total="1.00")]},
    {"items": [item(tax_rate="-0.01")]},
    {"items": [item(quantity="999999999.000", unit_price="9999999999999999.0000")]},
])
def test_invalid_financial_input_rolls_back(authenticated_api, client_record, changes):
    response = create(authenticated_api, client_record, **changes)
    assert response.status_code == 400, response.json()
    assert Invoice.objects.count() == 0 and InvoiceItem.objects.count() == 0


def test_workspace_isolation_and_shared_colleague_access(authenticated_api, user, other_user, client_record):
    invoice = create(authenticated_api, client_record).json()
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign")
    assert create(authenticated_api, foreign).status_code == 404
    colleague = get_user_model().objects.create_user(username="invoice-colleague", password="test-password-123")
    call_command("assign_workspace", colleague.username, str(client_record.workspace_id))
    colleague_api = APIClient()
    colleague_api.force_login(colleague)
    assert colleague_api.get("/api/v1/invoices").json()["count"] == 1
    assert colleague_api.patch(f"/api/v1/invoices/{invoice['id']}/status", {"status": "sent"}, format="json").status_code == 200
    foreign_api = APIClient()
    foreign_api.force_login(other_user)
    assert foreign_api.get("/api/v1/invoices").json()["results"] == []
    assert foreign_api.get(f"/api/v1/invoices/{invoice['id']}").status_code == 404
    assert foreign_api.patch(f"/api/v1/invoices/{invoice['id']}", {"currency": "USD"}, format="json").status_code == 404


def test_auth_csrf_filters_and_number_sequence(authenticated_api, user, client_record):
    unauthenticated = APIClient(enforce_csrf_checks=True)
    assert unauthenticated.get("/api/v1/invoices").status_code == 403
    no_csrf = APIClient(enforce_csrf_checks=True)
    no_csrf.force_login(user)
    assert no_csrf.post("/api/v1/invoices", payload(client_record), format="json").status_code == 403
    first = create(authenticated_api, client_record).json()
    second = create(authenticated_api, client_record, currency="USD").json()
    assert second["invoice_number"] == "INV-000002"
    assert authenticated_api.get("/api/v1/invoices?currency=USD").json()["count"] == 1
    assert authenticated_api.get("/api/v1/invoices?page_size=1&page=2").json()["results"][0]["id"] == first["id"]
    assert authenticated_api.get("/api/v1/invoices?search=INV-000001").json()["results"][0]["id"] == first["id"]
    assert authenticated_api.get("/api/v1/invoices?status=invalid").status_code == 400
    assert authenticated_api.get("/api/v1/invoices").json()["results"][0]["id"] == second["id"]


@pytest.mark.django_db(transaction=True)
def test_concurrent_numbers_are_unique(user, client_record):
    gate = Barrier(2)

    def submit():
        close_old_connections()
        api = APIClient()
        api.force_login(user)
        gate.wait()
        response = create(api, client_record)
        close_old_connections()
        return response.status_code, response.json().get("invoice_number")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))
    assert sorted(results) == [(201, "INV-000001"), (201, "INV-000002")]
