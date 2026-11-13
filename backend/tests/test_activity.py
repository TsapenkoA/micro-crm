from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from crm.models import ActivityEvent, Client, Deal


pytestmark = pytest.mark.django_db


def signed_in(user):
    api = APIClient(enforce_csrf_checks=True)
    api.force_login(user)
    api.credentials(HTTP_X_CSRFTOKEN=api.get("/api/v1/auth/csrf").json()["csrfToken"])
    return api


def test_activity_tracks_deal_changes_and_isolated_by_workspace(user, other_user, client_record):
    owner = signed_in(user)
    foreign = signed_in(other_user)
    deal = owner.post("/api/v1/deals", {"client": str(client_record.pk), "title": "Proposal", "amount": "100", "currency": "USD"}, format="json").json()
    assert owner.patch(f"/api/v1/deals/{deal['id']}", {"version": deal["version"], "amount": "150", "deadline": (timezone.now() + timedelta(days=3)).isoformat()}, format="json").status_code == 200
    events = owner.get("/api/v1/activity").json()
    assert events["count"] == 2
    assert events["results"][0]["actor_name"] == user.username
    assert events["results"][0]["changes"]["amount"] == {"from": "100.00", "to": "150.00"}
    assert events["results"][0]["changes"]["deadline"]["to"] is not None
    assert events["results"][1]["action"] == "created"
    assert foreign.get("/api/v1/activity").json()["count"] == 0
    colleague = type(user).objects.create_user(username="colleague", password="test-password-123")
    call_command("assign_workspace", colleague.username, str(client_record.workspace_id), stdout=StringIO())
    assert signed_in(colleague).get("/api/v1/activity").json()["count"] == 2
    assert APIClient().get("/api/v1/activity").status_code == 403
    assert owner.get("/api/v1/activity?entity_type=wrong").status_code == 400


def test_activity_tracks_invoice_payment_and_omits_bank_details(user, client_record):
    api = signed_in(user)
    client_record.bank_details = {"iban": "SECRET-IBAN"}
    client_record.save()
    created = api.post("/api/v1/invoices", {"client": str(client_record.pk), "currency": "EUR", "items": [{"description": "Work", "quantity": "1", "unit_price": "100", "tax_rate": "0"}]}, format="json")
    assert created.status_code == 201
    path = f"/api/v1/invoices/{created.json()['id']}"
    assert api.patch(path + "/status", {"status": "sent"}, format="json").status_code == 200
    assert api.post(path + "/payments", {"amount": "25", "reference": "SECRET-REFERENCE"}, format="json").status_code == 201
    events = api.get("/api/v1/activity?entity_type=invoice").json()
    assert [event["action"] for event in events["results"]] == ["payment_recorded", "updated", "created"]
    assert events["results"][0]["changes"]["payment_amount"] == "25.00"
    assert events["results"][1]["changes"]["status"] == {"from": "draft", "to": "sent"}
    assert "SECRET-IBAN" not in str(events)
    assert "SECRET-REFERENCE" not in str(events)


def test_editing_invoice_without_changing_total_is_still_recorded(user, client_record):
    api = signed_in(user)
    created = api.post("/api/v1/invoices", {"client": str(client_record.pk), "currency": "USD", "items": [{"description": "Work", "quantity": "1", "unit_price": "100", "tax_rate": "0"}]}, format="json")
    assert created.status_code == 201
    updated = api.patch(f"/api/v1/invoices/{created.json()['id']}", {"payment_terms": "Within 14 days"}, format="json")
    assert updated.status_code == 200
    events = api.get("/api/v1/activity?entity_type=invoice").json()["results"]
    assert [event["action"] for event in events] == ["edited", "created"]
    assert "Within 14 days" not in str(events)


def test_activity_tracks_task_assignee_and_does_not_log_rejected_changes(user, other_user, client_record):
    api = signed_in(user)
    due = (timezone.now() + timedelta(days=2)).isoformat()
    created = api.post("/api/v1/tasks", {"client": str(client_record.pk), "title": "Follow up", "due_at": due}, format="json")
    assert created.status_code == 201
    task_id = created.json()["id"]
    assert api.patch(f"/api/v1/tasks/{task_id}", {"assignee": other_user.pk}, format="json").status_code == 400
    assert api.patch(f"/api/v1/tasks/{task_id}", {"status": "done"}, format="json").status_code == 200
    events = api.get("/api/v1/activity?entity_type=task").json()
    assert events["count"] == 2
    assert events["results"][0]["changes"]["status"] == {"from": "open", "to": "done"}
    assert ActivityEvent.objects.filter(workspace=client_record.workspace).count() == 2


def test_activity_paginates_and_retains_deleted_record_label(user, client_record):
    api = signed_in(user)
    for index in range(21):
        response = api.post("/api/v1/clients", {"name": f"Client {index}"}, format="json")
        assert response.status_code == 201
    first = api.get("/api/v1/activity?page_size=10").json()
    assert first["count"] == 21 and len(first["results"]) == 10 and first["next"]
    assert api.delete(f"/api/v1/clients/{response.json()['id']}").status_code == 204
    assert api.get("/api/v1/activity").json()["results"][0]["entity_label"] == "Client 20"
