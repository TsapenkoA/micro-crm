from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from crm.models import Deal, Invoice, Task


pytestmark = pytest.mark.django_db


def signed_in(user):
    api = APIClient()
    api.force_login(user)
    return api


def test_operations_shows_due_work_and_isolates_workspaces(user, other_user, client_record):
    company = client_record.workspace
    now = timezone.now()
    task = Task.objects.create(workspace=company, client=client_record, created_by=user, assignee=user,
                               title="Review scope", due_at=now - timedelta(hours=1))
    deal = Deal.objects.create(workspace=company, created_by=user, client=client_record,
                               title="Proposal", amount=100, currency="USD", deadline=now + timedelta(days=2))
    invoice = Invoice.objects.create(workspace=company, created_by=user, client=client_record,
                                     invoice_number="INV-OPS-1", currency="USD", status=Invoice.Status.SENT,
                                     issued_at=now, due_date=timezone.localdate() - timedelta(days=1), total_amount=100)
    Task.objects.create(workspace=company, client=client_record, created_by=user, assignee=user,
                        title="Later task", due_at=now + timedelta(days=10))
    Task.objects.create(workspace=company, client=client_record, created_by=user, assignee=user,
                        title="Done task", due_at=now, status=Task.Status.DONE, completed_at=now)
    foreign = signed_in(other_user).get("/api/v1/operations/overview")
    assert foreign.status_code == 200
    assert foreign.json()["today"]["count"] == 0

    result = signed_in(user).get("/api/v1/operations/overview")
    assert result.status_code == 200
    today = result.json()["today"]
    reminders = result.json()["reminders"]
    assert today["count"] == 3
    assert reminders["count"] == 2
    assert {item["id"] for item in today["results"]} == {str(task.pk), str(deal.pk), str(invoice.pk)}
    assert next(item for item in today["results"] if item["id"] == str(task.pk))["overdue"] is True
    assert {item["kind"] for item in reminders["results"]} == {"deal", "invoice"}
    assert [item["overdue"] for item in reminders["results"]] == [True, False]
    assert "bank_details" not in str(result.json())
    assert APIClient().get("/api/v1/operations/overview").status_code == 403

    colleague = type(user).objects.create_user(username="operations_colleague", password="test-password-123")
    call_command("assign_workspace", colleague.username, str(company.pk), stdout=StringIO())
    shared = signed_in(colleague).get("/api/v1/operations/overview").json()
    assert shared["today"]["count"] == 2
    assert shared["reminders"]["count"] == 2


def test_operations_excludes_finished_financial_work(user, client_record):
    now = timezone.now()
    Deal.objects.create(workspace=client_record.workspace, created_by=user, client=client_record,
                        title="Finished", amount=100, currency="USD", status=Deal.Status.PAID,
                        paid_at=now, deadline=now)
    Invoice.objects.create(workspace=client_record.workspace, created_by=user, client=client_record,
                           invoice_number="INV-OPS-2", currency="USD", status=Invoice.Status.PAID,
                           paid_at=now, issued_at=now, due_date=timezone.localdate() - timedelta(days=1))
    response = signed_in(user).get("/api/v1/operations/overview")
    assert response.status_code == 200
    assert response.json()["today"]["count"] == 0
    assert response.json()["reminders"]["count"] == 0
