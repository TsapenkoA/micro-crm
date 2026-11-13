from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from crm.models import ActivityEvent, Client, Deal, Task, WorkspaceMembership


pytestmark = pytest.mark.django_db


def signed_in(user):
    api = APIClient(enforce_csrf_checks=True)
    api.force_login(user)
    return api, api.get("/api/v1/auth/csrf").json()["csrfToken"]


def test_tasks_are_shared_within_workspace_and_isolated_from_other_companies(user, other_user, client_record):
    company = user.workspace_membership.workspace
    colleague = type(user).objects.create_user(username="colleague", password="test-password-123")
    call_command("assign_workspace", colleague.username, str(company.pk), stdout=StringIO())
    deal = Deal.objects.create(workspace=company, created_by=user, client=client_record, title="Proposal", amount=100, currency="USD")
    owner, token = signed_in(user)
    due = (timezone.now() + timedelta(days=1)).isoformat()
    payload = {"client": str(client_record.pk), "deal": str(deal.pk), "title": "Send proposal", "assignee": colleague.pk, "due_at": due}
    assert owner.post("/api/v1/tasks", payload, format="json").status_code == 403
    created = owner.post("/api/v1/tasks", payload, format="json", HTTP_X_CSRFTOKEN=token)
    assert created.status_code == 201
    task_id = created.json()["id"]
    assert created.json()["assignee_name"] == "colleague"
    assert owner.get("/api/v1/tasks?status=open").json()["count"] == 1
    assert owner.get("/api/v1/tasks?mine=1").json()["count"] == 0

    teammate, teammate_token = signed_in(colleague)
    assert teammate.get("/api/v1/tasks?mine=1").json()["results"][0]["id"] == task_id
    done = teammate.patch(f"/api/v1/tasks/{task_id}", {"status": "done"}, format="json", HTTP_X_CSRFTOKEN=teammate_token)
    assert done.status_code == 200
    assert done.json()["completed_at"] is not None
    assert owner.get("/api/v1/tasks?status=done").json()["count"] == 1
    assert teammate.patch(f"/api/v1/tasks/{task_id}", {"status": "open"}, format="json", HTTP_X_CSRFTOKEN=teammate_token).json()["completed_at"] is None

    foreign, foreign_token = signed_in(other_user)
    assert foreign.get("/api/v1/tasks").json()["count"] == 0
    assert foreign.get(f"/api/v1/tasks/{task_id}").status_code == 404
    assert foreign.patch(f"/api/v1/tasks/{task_id}", {"status": "done"}, format="json", HTTP_X_CSRFTOKEN=foreign_token).status_code == 404
    assert foreign.post("/api/v1/tasks", payload, format="json", HTTP_X_CSRFTOKEN=foreign_token).status_code == 400
    assert owner.patch(f"/api/v1/tasks/{task_id}", {"assignee": other_user.pk}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 400
    assert Task.objects.get(pk=task_id).status == "open"


def test_task_filters_validation_and_pagination(user, other_user, client_record):
    api, token = signed_in(user)
    now = timezone.now()
    for index in range(3):
        payload = {"client": str(client_record.pk), "title": f"Follow up {index}", "due_at": (now + timedelta(days=-1 if index == 0 else index)).isoformat()}
        assert api.post("/api/v1/tasks", payload, format="json", HTTP_X_CSRFTOKEN=token).status_code == 201
    assert api.get("/api/v1/tasks?due=overdue").json()["count"] == 1
    assert api.get("/api/v1/tasks?due=upcoming").json()["count"] == 2
    assert api.get("/api/v1/tasks?page_size=2").json()["next"] is not None
    assert api.get("/api/v1/tasks?search=Follow%20up%202").json()["count"] == 1
    assert api.get(f"/api/v1/tasks?client={client_record.pk}").json()["count"] == 3
    foreign_client = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign")
    assert api.get(f"/api/v1/tasks?client={foreign_client.pk}").json()["count"] == 0
    assert api.get("/api/v1/tasks?client=invalid").status_code == 400
    assert api.get("/api/v1/tasks?status=invalid").status_code == 400
    assert api.get("/api/v1/tasks?due=invalid").status_code == 400
    assert api.post("/api/v1/tasks", {"client": str(client_record.pk), "title": " "}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 400
    assert api.get("/api/v1/tasks").json()["count"] == 3


def test_tasks_can_be_filtered_by_linked_deal(user, client_record):
    api, token = signed_in(user)
    deal = Deal.objects.create(workspace=client_record.workspace, created_by=user, client=client_record, title="Proposal", amount=100, currency="USD")
    payload = {"client": str(client_record.pk), "deal": str(deal.pk), "title": "Review proposal", "due_at": (timezone.now() + timedelta(days=1)).isoformat()}
    assert api.post("/api/v1/tasks", payload, format="json", HTTP_X_CSRFTOKEN=token).status_code == 201
    assert api.get(f"/api/v1/tasks?deal={deal.pk}").json()["count"] == 1
    assert api.get("/api/v1/tasks?deal=invalid").status_code == 400


def test_removing_member_unassigns_their_tasks_without_losing_them(user, client_record):
    colleague = type(user).objects.create_user(username="colleague", password="test-password-123")
    company = user.workspace_membership.workspace
    call_command("assign_workspace", colleague.username, str(company.pk), stdout=StringIO())
    task = Task.objects.create(workspace=company, client=client_record, created_by=user, assignee=colleague,
                               title="Review draft", due_at=timezone.now() + timedelta(days=2))
    api = APIClient(enforce_csrf_checks=True)
    csrf = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    token = api.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json", HTTP_X_CSRFTOKEN=csrf).json()["csrfToken"]
    assert api.delete(f"/api/v1/workspace/members/{colleague.pk}", HTTP_X_CSRFTOKEN=token).status_code == 204
    task.refresh_from_db()
    assert task.assignee_id is None
    assert task.workspace_id == company.pk
    assert ActivityEvent.objects.get(entity_id=task.pk).changes["assignee"] == {"from": colleague.username, "to": None}
    assert WorkspaceMembership.objects.get(user=colleague).workspace_id != company.pk
    assert api.get(f"/api/v1/tasks/{task.pk}").json()["assignee_name"] is None
    assert api.patch(f"/api/v1/tasks/{task.pk}", {"assignee": user.pk}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 200
