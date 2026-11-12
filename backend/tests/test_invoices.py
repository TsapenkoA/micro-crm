from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from threading import Barrier

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core import mail
from django.db import close_old_connections
from django.test import override_settings
from django.utils import timezone

import pytest
from pypdf import PdfReader
from rest_framework.test import APIClient

from crm.models import Client, Deal, Invoice, InvoiceDelivery, InvoiceItem, InvoicePayment

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


def test_due_date_terms_and_pdf_are_frozen_when_issued(authenticated_api, client_record):
    due = timezone.localdate() + timedelta(days=14)
    created = create(authenticated_api, client_record, due_date=due.isoformat(), payment_terms="Bank transfer within 14 days.").json()
    path = f"/api/v1/invoices/{created['id']}"
    issued = authenticated_api.patch(path + "/status", {"status": "sent"}, format="json")
    assert issued.status_code == 200
    assert issued.json()["due_date"] == due.isoformat()
    assert issued.json()["payment_terms"] == "Bank transfer within 14 days."
    assert authenticated_api.patch(path, {"due_date": (due + timedelta(days=1)).isoformat()}, format="json").status_code == 400
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(authenticated_api.get(path + "/pdf").content)).pages)
    assert due.strftime("%Y") in text and "Bank transfer within 14 days." in text


def test_partial_payments_balance_overdue_and_cancellation(authenticated_api, client_record):
    created = create(authenticated_api, client_record, items=[item(unit_price="100")]).json()
    path = f"/api/v1/invoices/{created['id']}"
    issued = authenticated_api.patch(path + "/status", {"status": "sent"}, format="json")
    assert issued.status_code == 200 and issued.json()["due_date"] == (timezone.localdate() + timedelta(days=30)).isoformat()
    first = authenticated_api.post(path + "/payments", {"amount": "40.00", "reference": "Bank receipt 1"}, format="json")
    assert first.status_code == 201, first.json()
    assert first.json()["status"] == "sent" and first.json()["paid_amount"] == "40.00" and first.json()["balance_due"] == "60.00"
    assert authenticated_api.get("/api/v1/analytics/dashboard?currency=EUR").json()["revenue"] == "40.00"
    assert authenticated_api.post(path + "/payments", {"amount": "61.00"}, format="json").status_code == 400
    assert authenticated_api.post(path + "/cancel", {"reason": "Incorrect"}, format="json").status_code == 400
    Invoice.objects.filter(pk=created["id"]).update(due_date=timezone.localdate() - timedelta(days=1))
    assert authenticated_api.get(path).json()["overdue"] is True
    assert authenticated_api.get("/api/v1/invoices?overdue=true").json()["count"] == 1
    second = authenticated_api.post(path + "/payments", {"amount": "60.00", "reference": "Bank receipt 2"}, format="json")
    assert second.status_code == 201, second.json()
    assert second.json()["status"] == "paid" and second.json()["balance_due"] == "0.00" and len(second.json()["payments"]) == 2
    assert authenticated_api.get("/api/v1/analytics/dashboard?currency=EUR").json()["revenue"] == "100.00"
    assert InvoicePayment.objects.filter(invoice_id=created["id"]).count() == 2
    assert authenticated_api.get("/api/v1/invoices?overdue=true").json()["count"] == 0


def test_cancelling_preserves_issued_document_and_blocks_payments(authenticated_api, client_record):
    created = create(authenticated_api, client_record).json()
    path = f"/api/v1/invoices/{created['id']}"
    authenticated_api.patch(path + "/status", {"status": "sent"}, format="json")
    cancelled = authenticated_api.post(path + "/cancel", {"reason": "Duplicate invoice"}, format="json")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["total_amount"] == created["total_amount"]
    assert cancelled.json()["cancelled_at"] and cancelled.json()["cancellation_reason"] == "Duplicate invoice"
    assert authenticated_api.post(path + "/payments", {"amount": "1"}, format="json").status_code == 400
    assert authenticated_api.post(path + "/send", {}, format="json").status_code == 400
    assert authenticated_api.get(path + "/pdf").status_code == 200


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_email_delivery_and_reminder_are_explicit_and_rate_limited(authenticated_api, client_record):
    created = create(authenticated_api, client_record).json()
    path = f"/api/v1/invoices/{created['id']}"
    sent = authenticated_api.post(path + "/send", {}, format="json")
    assert sent.status_code == 200, sent.json()
    assert sent.json()["status"] == "sent" and sent.json()["deliveries"][0]["result"] == "accepted"
    assert len(mail.outbox) == 1 and mail.outbox[0].to == [client_record.email]
    assert mail.outbox[0].attachments[0][2] == "application/pdf"
    assert authenticated_api.post(path + "/send", {}, format="json").status_code == 409
    Invoice.objects.filter(pk=created["id"]).update(due_date=timezone.localdate() - timedelta(days=1))
    preview = authenticated_api.get(path + "/reminder")
    assert preview.status_code == 200 and preview.json()["can_send"] is True
    assert created["invoice_number"] in preview.json()["body"]
    reminded = authenticated_api.post(path + "/reminder", {}, format="json")
    assert reminded.status_code == 200 and len(mail.outbox) == 2
    assert reminded.json()["deliveries"][0]["kind"] == "reminder"
    assert authenticated_api.post(path + "/reminder", {}, format="json").status_code == 400
    assert InvoiceDelivery.objects.filter(invoice_id=created["id"], result="accepted").count() == 2


@override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend")
def test_email_does_not_claim_delivery_without_mail_backend(authenticated_api, client_record):
    created = create(authenticated_api, client_record).json()
    response = authenticated_api.post(f"/api/v1/invoices/{created['id']}/send", {}, format="json")
    assert response.status_code == 503
    assert Invoice.objects.get(pk=created["id"]).status == Invoice.Status.DRAFT


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_lifecycle_actions_require_workspace_access_and_csrf(authenticated_api, user, other_user, client_record):
    created = create(authenticated_api, client_record).json()
    path = f"/api/v1/invoices/{created['id']}"
    outsider = APIClient(enforce_csrf_checks=True)
    outsider.force_login(other_user)
    outsider.credentials(HTTP_X_CSRFTOKEN=outsider.get("/api/v1/auth/csrf").json()["csrfToken"])
    for suffix in ("/send", "/payments", "/cancel", "/reminder"):
        assert outsider.post(path + suffix, {}, format="json").status_code == 404
    assert outsider.get(path + "/reminder").status_code == 404

    no_csrf = APIClient(enforce_csrf_checks=True)
    no_csrf.force_login(user)
    for suffix in ("/send", "/payments", "/cancel", "/reminder"):
        assert no_csrf.post(path + suffix, {}, format="json").status_code == 403
    assert Invoice.objects.get(pk=created["id"]).status == Invoice.Status.DRAFT
    assert not InvoicePayment.objects.exists() and not InvoiceDelivery.objects.exists()


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_failed_email_attempt_is_logged_and_can_be_retried(authenticated_api, client_record, monkeypatch):
    created = create(authenticated_api, client_record).json()
    path = f"/api/v1/invoices/{created['id']}"
    monkeypatch.setattr("crm.invoices.delivery.EmailMessage.send", lambda *args, **kwargs: 0)
    failed = authenticated_api.post(path + "/send", {}, format="json")
    assert failed.status_code == 503
    saved = authenticated_api.get(path).json()
    assert saved["status"] == "sent" and saved["deliveries"][0]["result"] == "failed"
    assert saved["deliveries"][0]["recipient"] == client_record.email
    monkeypatch.setattr("crm.invoices.delivery.EmailMessage.send", lambda *args, **kwargs: 1)
    retried = authenticated_api.post(path + "/send", {}, format="json")
    assert retried.status_code == 200 and retried.json()["deliveries"][0]["result"] == "accepted"


def test_payment_validation_keeps_financial_totals_unchanged(authenticated_api, client_record):
    created = create(authenticated_api, client_record).json()
    path = f"/api/v1/invoices/{created['id']}"
    assert authenticated_api.patch(path + "/status", {"status": "sent"}, format="json").status_code == 200
    for amount in ("0", "10.001", "11"):
        assert authenticated_api.post(path + "/payments", {"amount": amount}, format="json").status_code == 400
    assert authenticated_api.post(path + "/payments", {"amount": "1", "received_on": (timezone.localdate() + timedelta(days=1)).isoformat()}, format="json").status_code == 400
    assert authenticated_api.get(path).json()["balance_due"] == "10.00"
    assert InvoicePayment.objects.count() == 0


def test_invoice_deal_link_is_optional_shared_and_independent(authenticated_api, user, client_record):
    deal = Deal.objects.create(workspace=client_record.workspace, created_by=user, client=client_record, title="Website", amount="500", currency="EUR")
    first = create(authenticated_api, client_record, deal=str(deal.pk))
    second = create(authenticated_api, client_record, deal=str(deal.pk))
    old_style = create(authenticated_api, client_record)
    assert [response.status_code for response in (first, second, old_style)] == [201, 201, 201]
    assert first.json()["deal"] == second.json()["deal"] == str(deal.pk)
    assert old_style.json()["deal"] is None
    assert authenticated_api.get(f"/api/v1/invoices?deal={deal.pk}").json()["count"] == 2
    assert authenticated_api.get(f"/api/v1/invoices/{first.json()['id']}").json()["deal"] == str(deal.pk)
    sent = authenticated_api.patch(f"/api/v1/invoices/{first.json()['id']}/status", {"status": "sent"}, format="json")
    paid = authenticated_api.patch(f"/api/v1/invoices/{first.json()['id']}/status", {"status": "paid"}, format="json")
    assert sent.status_code == paid.status_code == 200
    deal.refresh_from_db()
    assert deal.status == Deal.Status.NEW_LEAD and deal.amount == Decimal("500")
    assert Invoice.objects.get(pk=first.json()["id"]).total_amount == Decimal("10")
    delete = authenticated_api.delete(f"/api/v1/deals/{deal.pk}", {"version": deal.version}, format="json")
    assert delete.status_code == 409


def test_invoice_deal_must_match_client_and_workspace(authenticated_api, user, other_user, client_record):
    second_client = Client.objects.create(workspace=client_record.workspace, created_by=user, name="Other client", email="other-client@example.com")
    own_deal = Deal.objects.create(workspace=client_record.workspace, created_by=user, client=client_record, title="Own", amount="100", currency="EUR")
    wrong_client_deal = Deal.objects.create(workspace=client_record.workspace, created_by=user, client=second_client, title="Different client", amount="100", currency="EUR")
    foreign_client = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign", email="foreign@example.com")
    foreign_deal = Deal.objects.create(workspace=foreign_client.workspace, created_by=other_user, client=foreign_client, title="Foreign", amount="100", currency="EUR")
    assert create(authenticated_api, client_record, deal=str(wrong_client_deal.pk)).status_code == 400
    assert create(authenticated_api, client_record, deal=str(foreign_deal.pk)).status_code == 404
    invoice = create(authenticated_api, client_record, deal=str(own_deal.pk)).json()
    assert authenticated_api.patch(f"/api/v1/deals/{own_deal.pk}", {"client": str(second_client.pk), "version": own_deal.version}, format="json").status_code == 400
    assert authenticated_api.patch(f"/api/v1/invoices/{invoice['id']}", {"client": str(second_client.pk)}, format="json").status_code == 400
    changed = authenticated_api.patch(f"/api/v1/invoices/{invoice['id']}", {"client": str(second_client.pk), "deal": None}, format="json")
    assert changed.status_code == 200 and changed.json()["deal"] is None
    assert authenticated_api.get(f"/api/v1/invoices?deal={foreign_deal.pk}").json()["count"] == 0
    assert authenticated_api.patch(f"/api/v1/deals/{own_deal.pk}", {"client": str(second_client.pk), "version": own_deal.version}, format="json").status_code == 200


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


def test_bank_details_are_workspace_scoped_and_frozen_in_invoices(authenticated_api, other_user, client_record):
    seller_bank = {"account_holder": "Acme Studio", "bank_name": "Example Bank", "iban": "DE89370400440532013000", "bic": "COBADEFF"}
    buyer_bank = {"account_holder": "Client Ltd", "account_number": "12345678", "routing_number": "021000021"}
    saved = authenticated_api.put("/api/v1/workspace/bank-details", seller_bank, format="json")
    assert saved.status_code == 200, saved.json()
    assert saved.json() == seller_bank
    assert saved["Cache-Control"] == "no-store"
    updated = authenticated_api.patch(f"/api/v1/clients/{client_record.pk}", {"bank_details": buyer_bank}, format="json")
    assert updated.status_code == 200, updated.json()
    assert authenticated_api.get(f"/api/v1/clients/{client_record.pk}").json()["bank_details"] == buyer_bank
    assert "bank_details" not in authenticated_api.get("/api/v1/clients").json()["results"][0]

    created = create(authenticated_api, client_record)
    assert created.status_code == 201, created.json()
    assert created.json()["seller_snapshot"]["bank_details"] == seller_bank
    assert created.json()["buyer_snapshot"]["bank_details"] == buyer_bank
    invoice_id = created.json()["id"]
    pdf = authenticated_api.get(f"/api/v1/invoices/{invoice_id}/pdf")
    assert pdf.status_code == 200
    pdf_text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf.content)).pages)
    assert "DE89370400440532013000" in pdf_text and "021000021" in pdf_text

    assert authenticated_api.put("/api/v1/workspace/bank-details", {"bank_name": "New Bank"}, format="json").status_code == 200
    assert authenticated_api.patch(f"/api/v1/clients/{client_record.pk}", {"bank_details": {}}, format="json").status_code == 200
    old = authenticated_api.get(f"/api/v1/invoices/{invoice_id}").json()
    assert old["seller_snapshot"]["bank_details"] == seller_bank
    assert old["buyer_snapshot"]["bank_details"] == buyer_bank

    outsider = APIClient(enforce_csrf_checks=True)
    outsider.force_login(other_user)
    outsider.credentials(HTTP_X_CSRFTOKEN=outsider.get("/api/v1/auth/csrf").json()["csrfToken"])
    assert outsider.get("/api/v1/workspace/bank-details").json() == {}
    assert outsider.get(f"/api/v1/clients/{client_record.pk}").status_code == 404
    assert outsider.patch(f"/api/v1/clients/{client_record.pk}", {"bank_details": buyer_bank}, format="json").status_code == 404
    assert outsider.get(f"/api/v1/invoices/{invoice_id}").status_code == 404

    colleague = get_user_model().objects.create_user(username="colleague", password="colleague-password-123")
    membership = colleague.workspace_membership
    membership.workspace = client_record.workspace
    membership.save()
    teammate = APIClient(enforce_csrf_checks=True)
    teammate.force_login(colleague)
    assert teammate.get("/api/v1/workspace/bank-details").status_code == 403
    assert teammate.get(f"/api/v1/invoices/{invoice_id}").json()["seller_snapshot"]["bank_details"] == seller_bank
    assert teammate.put("/api/v1/workspace/bank-details", {"bank_name": "Blocked without CSRF"}, format="json").status_code == 403
    token = teammate.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert teammate.put("/api/v1/workspace/bank-details", {"bank_name": "Blocked"}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 403
    owner_details = authenticated_api.get("/api/v1/workspace/bank-details")
    assert owner_details["Cache-Control"] == "no-store"
    assert owner_details.json() == {"bank_name": "New Bank"}


def test_saved_payment_details_require_recent_owner_authentication(authenticated_api, user):
    path = "/api/v1/workspace/bank-details"
    assert authenticated_api.put(path, {"bank_name": "Private Bank"}, format="json").status_code == 200
    session = authenticated_api.session
    session["auth_time"] = 0
    session.save()

    assert authenticated_api.get(path).status_code == 403
    assert authenticated_api.put(path, {"bank_name": "Changed Bank"}, format="json").status_code == 403
    workspace = user.workspace_membership.workspace
    workspace.refresh_from_db()
    assert workspace.bank_details == {"bank_name": "Private Bank"}


def test_workspace_seller_profile_prefills_new_invoices_without_rewriting_old_ones(authenticated_api, user, client_record):
    path = "/api/v1/workspace/seller-details"
    old = create(authenticated_api, client_record).json()
    first_profile = {"name": "Example Agency Ltd", "email": "billing@example.test", "phone": "+1 202 555 0100", "address": "12 Main Street, London", "tax_id": "GB123456789"}
    saved = authenticated_api.put(path, first_profile, format="json")
    assert saved.status_code == 200 and saved.json() == first_profile
    assert saved["Cache-Control"] == "no-store"
    assert authenticated_api.get(path).json() == first_profile

    created = create(authenticated_api, client_record).json()
    assert created["seller_snapshot"] == first_profile
    pdf = authenticated_api.get(f"/api/v1/invoices/{created['id']}/pdf")
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf.content)).pages)
    assert "Example Agency Ltd" in text and "GB123456789" in text and "+1 202 555 0100" in text

    second_profile = {**first_profile, "name": "Renamed Agency", "address": "45 New Road"}
    assert authenticated_api.put(path, second_profile, format="json").status_code == 200
    current = authenticated_api.get(f"/api/v1/invoices/{created['id']}").json()
    assert current["seller_snapshot"] == first_profile
    assert authenticated_api.get(f"/api/v1/invoices/{old['id']}").json()["seller_snapshot"]["name"] == user.workspace_membership.workspace.name
    unchanged_pdf = authenticated_api.get(f"/api/v1/invoices/{created['id']}/pdf")
    assert "Example Agency Ltd" in "\n".join(page.extract_text() for page in PdfReader(BytesIO(unchanged_pdf.content)).pages)
    assert create(authenticated_api, client_record).json()["seller_snapshot"] == second_profile


def test_seller_profile_is_owner_only_validated_and_requires_recent_auth(authenticated_api, user, other_user, client_record):
    path = "/api/v1/workspace/seller-details"
    assert authenticated_api.put(path, {"name": "Incomplete"}, format="json").status_code == 400
    assert authenticated_api.put(path, {"name": "Agency", "email": "invalid"}, format="json").status_code == 400
    assert authenticated_api.put(path, {"name": "Agency", "email": "agency@example.test", "owner": "other"}, format="json").status_code == 400
    profile = {"name": "Agency", "email": "agency@example.test"}
    assert authenticated_api.put(path, profile, format="json").status_code == 200

    colleague = get_user_model().objects.create_user(username="seller-colleague", password="test-password-123")
    call_command("assign_workspace", colleague.username, str(client_record.workspace_id))
    teammate = APIClient(enforce_csrf_checks=True)
    teammate.force_login(colleague)
    teammate.credentials(HTTP_X_CSRFTOKEN=teammate.get("/api/v1/auth/csrf").json()["csrfToken"])
    assert teammate.get(path).status_code == 403
    assert teammate.put(path, profile, format="json").status_code == 403
    assert create(teammate, client_record).json()["seller_snapshot"] == profile

    outsider = APIClient(enforce_csrf_checks=True)
    outsider.force_login(other_user)
    outsider.credentials(HTTP_X_CSRFTOKEN=outsider.get("/api/v1/auth/csrf").json()["csrfToken"])
    assert outsider.get(path).json() == {}
    assert outsider.put(path, {"name": "Foreign", "email": "foreign@example.test"}, format="json").status_code == 200
    assert authenticated_api.get(path).json() == profile

    session = authenticated_api.session
    session["auth_time"] = 0
    session.save()
    assert authenticated_api.get(path).status_code == 403
    assert authenticated_api.put(path, profile, format="json").status_code == 403


def test_bank_details_reject_unknown_fields_and_invalid_identifiers(authenticated_api, client_record):
    assert authenticated_api.put("/api/v1/workspace/bank-details", {"other": "secret"}, format="json").status_code == 400
    assert authenticated_api.put("/api/v1/workspace/bank-details", {"bic": "bad"}, format="json").status_code == 400
    assert authenticated_api.patch(f"/api/v1/clients/{client_record.pk}", {"bank_details": {"iban": "invalid"}}, format="json").status_code == 400
    assert authenticated_api.get("/api/v1/workspace/bank-details").json() == {}
    client_record.refresh_from_db()
    assert client_record.bank_details == {}


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


@pytest.mark.parametrize("currency,unit_price,expected", [("JPY", "10.6", "11"), ("GBP", "10.005", "10.01"), ("PLN", "10.125", "10.13"), ("USD", "10.005", "10.01")])
def test_currency_precision(authenticated_api, client_record, currency, unit_price, expected):
    response = create(authenticated_api, client_record, currency=currency, items=[item(unit_price=unit_price)])
    assert response.status_code == 201, response.json()
    assert response.json()["total_amount"] == expected


@pytest.mark.parametrize("currency", ["CLF", "UAH", "KWD"])
def test_removed_currencies_cannot_be_used_for_new_invoices(authenticated_api, client_record, currency):
    assert create(authenticated_api, client_record, currency=currency).status_code == 400


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
