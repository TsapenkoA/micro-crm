import uuid
from datetime import datetime, timedelta, timezone

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.models import WorkspaceMembership
from apps.clients.models import Client, ClientLink, ClientNote
from apps.deals.models import Deal
from apps.invoices.models import Invoice

pytestmark = pytest.mark.django_db


@pytest.fixture
def authenticated_api(api, user):
    api.force_login(user)
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    api.credentials(HTTP_X_CSRFTOKEN=token)
    return api


@pytest.fixture
def colleague(user):
    from django.core.management import call_command

    colleague = get_user_model().objects.create_user(username="colleague", password="colleague-password")
    call_command("assign_workspace", colleague.username, str(user.workspace_membership.workspace_id))
    return colleague


def test_create_and_detail(authenticated_api, user):
    response = authenticated_api.post("/api/v1/clients", {"name": "Acme", "company": "Studio", "email": "hello@example.com", "phone": "+49 123 456"}, format="json")
    assert response.status_code == 201
    data = response.json()
    assert data["workspace"] == str(user.workspace_membership.workspace_id)
    assert data["created_by"] == user.pk
    assert data["created_at"] and data["updated_at"]
    detail = authenticated_api.get(f"/api/v1/clients/{data['id']}")
    assert detail.status_code == 200
    assert detail.json() == {**data, "deals": []}


def test_list_empty_and_stable_pagination(authenticated_api, user):
    assert authenticated_api.get("/api/v1/clients").json() == {"count": 0, "next": None, "previous": None, "results": []}
    older = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for name, number, created_at in [("Zulu", 1, older + timedelta(days=1)), ("Alpha", 2, older), ("Alpha", 3, older)]:
        client = Client.objects.create(id=uuid.UUID(int=number), workspace=user.workspace_membership.workspace, created_by=user, name=name)
        Client.objects.filter(pk=client.pk).update(created_at=created_at)
    first = authenticated_api.get("/api/v1/clients?page_size=2").json()
    second = authenticated_api.get("/api/v1/clients?page_size=2&page=2").json()
    expected = [uuid.UUID(int=number) for number in [1, 3, 2]]
    assert [row["id"] for row in first["results"] + second["results"]] == [str(pk) for pk in expected]
    assert first["count"] == second["count"] == 3
    assert first["next"] and second["previous"]
    assert first == authenticated_api.get("/api/v1/clients?page_size=2").json()
    assert authenticated_api.get("/api/v1/clients?page=999").status_code == 404

    filtered_first = authenticated_api.get("/api/v1/clients?search=Alpha&page_size=1").json()
    filtered_second = authenticated_api.get("/api/v1/clients?search=Alpha&page_size=1&page=2").json()
    assert filtered_first["count"] == filtered_second["count"] == 2
    assert [row["id"] for row in filtered_first["results"] + filtered_second["results"]] == [str(uuid.UUID(int=3)), str(uuid.UUID(int=2))]


@pytest.mark.parametrize("search", ["acme", "STUDIO", "hello@example.com"])
def test_search_by_name_company_email(authenticated_api, user, search):
    client = Client.objects.create(workspace=user.workspace_membership.workspace, created_by=user, name="Acme", company="Studio", email="hello@example.com")
    Client.objects.create(workspace=user.workspace_membership.workspace, created_by=user, name="Unrelated")
    data = authenticated_api.get("/api/v1/clients", {"search": search}).json()
    assert data["count"] == 1
    assert data["results"][0]["id"] == str(client.pk)


def test_put_patch_and_delete(authenticated_api, client_record):
    path = f"/api/v1/clients/{client_record.pk}"
    response = authenticated_api.put(path, {"name": "Updated", "company": "Studio", "email": "new@example.com", "phone": "123"}, format="json")
    assert response.status_code == 200
    assert response.json()["name"] == "Updated"
    response = authenticated_api.patch(path, {"company": "New Studio"}, format="json")
    assert response.status_code == 200
    assert response.json()["company"] == "New Studio"
    assert response.json()["name"] == "Updated"
    assert authenticated_api.delete(path).status_code == 204
    assert not Client.objects.filter(pk=client_record.pk).exists()
    assert authenticated_api.get(path).status_code == 404


@pytest.mark.parametrize("payload", [
    {}, {"name": ""}, {"name": "   "}, {"name": "x" * 201},
    {"name": "Acme", "company": "x" * 201}, {"name": "Acme", "phone": "x" * 51},
    {"name": "Acme", "email": "not-an-email"}, {"name": None},
])
def test_create_validation(authenticated_api, payload):
    response = authenticated_api.post("/api/v1/clients", payload, format="json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == 400
    assert Client.objects.count() == 0


def test_update_validation_does_not_change_record(authenticated_api, client_record):
    path = f"/api/v1/clients/{client_record.pk}"
    assert authenticated_api.put(path, {"company": "Missing name"}, format="json").status_code == 400
    assert authenticated_api.patch(path, {"email": "invalid"}, format="json").status_code == 400
    client_record.refresh_from_db()
    assert client_record.name == "Acme"
    assert client_record.email == "hello@example.com"


@pytest.mark.parametrize("method,detail", [("get", False), ("post", False), ("get", True), ("put", True), ("patch", True), ("delete", True)])
def test_authentication_required(api, client_record, method, detail):
    path = f"/api/v1/clients/{client_record.pk}" if detail else "/api/v1/clients"
    assert getattr(api, method)(path).status_code == 403


@pytest.mark.parametrize("method,detail", [("post", False), ("put", True), ("patch", True), ("delete", True)])
def test_writes_require_csrf(api, user, client_record, method, detail):
    api.force_login(user)
    path = f"/api/v1/clients/{client_record.pk}" if detail else "/api/v1/clients"
    response = getattr(api, method)(path, {"name": "Unauthorized write"}, format="json")
    assert response.status_code == 403
    client_record.refresh_from_db()
    assert client_record.name == "Acme"


def test_colleagues_share_clients_and_updates(authenticated_api, user, colleague, client_record):
    api = APIClient()
    api.force_authenticate(user=colleague)
    path = f"/api/v1/clients/{client_record.pk}"
    assert api.get("/api/v1/clients").json()["count"] == 1
    assert api.get(path).status_code == 200
    assert api.patch(path, {"name": "Team edit"}, format="json").status_code == 200
    assert authenticated_api.get(path).json()["name"] == "Team edit"
    created = api.post("/api/v1/clients", {"name": "Team client"}, format="json")
    assert created.status_code == 201
    assert authenticated_api.get(f"/api/v1/clients/{created.json()['id']}").status_code == 200
    assert api.delete(path).status_code == 204


def test_foreign_workspace_not_visible_in_list_search_or_detail(authenticated_api, other_user):
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Private", company="Private", email="private@example.com")
    for search in ["", "Private", "private@example.com"]:
        response = authenticated_api.get("/api/v1/clients", {"search": search})
        assert response.json()["count"] == 0
        assert "Private" not in str(response.json())
    path = f"/api/v1/clients/{foreign.pk}"
    for method in ["get", "put", "patch", "delete"]:
        response = getattr(authenticated_api, method)(path, {"name": "Hacked"}, format="json")
        assert response.status_code == 404
        assert "Private" not in str(response.json())
    foreign.refresh_from_db()
    assert foreign.name == "Private"
    assert authenticated_api.get(f"/api/v1/clients/{uuid.uuid4()}").status_code == 404


@pytest.mark.parametrize("field", ["workspace", "workspace_id", "created_by", "owner", "owner_id", "id", "created_at", "unexpected"])
def test_protected_and_unknown_fields_rejected(authenticated_api, client_record, other_user, field):
    value = str(other_user.workspace_membership.workspace_id)
    response = authenticated_api.post("/api/v1/clients", {"name": "Acme", field: value}, format="json")
    assert response.status_code == 400
    for method in ["put", "patch"]:
        response = getattr(authenticated_api, method)(f"/api/v1/clients/{client_record.pk}", {"name": "Changed", field: value}, format="json")
        assert response.status_code == 400
    client_record.refresh_from_db()
    assert client_record.name == "Acme"


def test_missing_membership_fails_closed(authenticated_api, user):
    WorkspaceMembership.objects.filter(user=user).delete()
    assert authenticated_api.get("/api/v1/clients").status_code == 403
    assert authenticated_api.post("/api/v1/clients", {"name": "No workspace"}, format="json").status_code == 403


def test_browser_accept_header_receives_json(authenticated_api):
    response = authenticated_api.get("/api/v1/clients", HTTP_ACCEPT="text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    assert response.status_code == 200
    assert response["Content-Type"].startswith("application/json")


def test_client_write_rejects_untrusted_origin(authenticated_api):
    response = authenticated_api.post("/api/v1/clients", {"name": "Forged"}, format="json", HTTP_ORIGIN="https://untrusted.example")
    assert response.status_code == 403
    assert not Client.objects.exists()


def test_invoice_protects_client(authenticated_api, user, client_record):
    invoice = Invoice.objects.create(workspace=client_record.workspace, created_by=user, client=client_record, invoice_number="INV-001", currency="EUR", buyer_snapshot={"name": "Acme"})
    response = authenticated_api.delete(f"/api/v1/clients/{client_record.pk}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == 409
    assert Client.objects.filter(pk=client_record.pk).exists()
    invoice.refresh_from_db()
    assert invoice.buyer_snapshot == {"name": "Acme"}


@pytest.mark.parametrize("child", ["note", "link"])
def test_other_related_records_protect_client(authenticated_api, user, client_record, child):
    if child == "note":
        ClientNote.objects.create(client=client_record, author=user, text="Keep history")
    else:
        ClientLink.objects.create(client=client_record, label="Brief", url="https://example.com")
    assert authenticated_api.delete(f"/api/v1/clients/{client_record.pk}").status_code == 409


def test_detail_returns_empty_deals_without_expanding_list_or_write_responses(authenticated_api, client_record):
    path = f"/api/v1/clients/{client_record.pk}"
    assert authenticated_api.get(path).json()["deals"] == []
    assert "deals" not in authenticated_api.get("/api/v1/clients").json()["results"][0]
    assert "deals" not in authenticated_api.put(path, {"name": "Updated"}, format="json").json()
    assert "deals" not in authenticated_api.patch(path, {"company": "Studio"}, format="json").json()
    assert authenticated_api.patch(path, {"deals": []}, format="json").status_code == 400


def test_detail_returns_related_workspace_deals(authenticated_api, user, colleague, client_record):
    deadline = datetime(2026, 12, 1, 12, tzinfo=timezone.utc)
    deal = Deal.objects.create(workspace=client_record.workspace, created_by=colleague, client=client_record, title="Shared project", amount="123.45", currency="EUR", deadline=deadline)
    unrelated = Client.objects.create(workspace=client_record.workspace, created_by=user, name="Other client")
    Deal.objects.create(workspace=client_record.workspace, created_by=user, client=unrelated, title="Other project", amount=1, currency="EUR")
    response = authenticated_api.get(f"/api/v1/clients/{client_record.pk}")
    assert response.status_code == 200
    assert response.json()["deals"] == [{"id": str(deal.pk), "title": "Shared project", "status": "new_lead", "amount": "123.45", "currency": "EUR", "deadline": "2026-12-01T12:00:00Z"}]


def test_list_counts_only_workspace_deals(authenticated_api, user, colleague, other_user, client_record):
    Deal.objects.create(workspace=client_record.workspace, created_by=colleague, client=client_record, title="Shared project", amount=10, currency="EUR")
    foreign_client = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign client")
    foreign_deal = Deal.objects.create(workspace=foreign_client.workspace, created_by=other_user, client=foreign_client, title="Foreign project", amount=20, currency="EUR")
    Deal.objects.filter(pk=foreign_deal.pk).update(client=client_record)

    response = authenticated_api.get("/api/v1/clients?search=Acme")
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["results"][0]["deal_count"] == 1
    assert "Foreign project" not in response.content.decode()
    assert "deal_count" not in authenticated_api.patch(f"/api/v1/clients/{client_record.pk}", {"phone": "123"}, format="json").json()


def test_detail_excludes_foreign_workspace_deals_even_with_inconsistent_link(authenticated_api, user, other_user, client_record):
    foreign_client = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Private client")
    foreign_deal = Deal.objects.create(workspace=foreign_client.workspace, created_by=other_user, client=foreign_client, title="Private project", amount=99, currency="EUR")
    Deal.objects.filter(pk=foreign_deal.pk).update(client=client_record)
    response = authenticated_api.get(f"/api/v1/clients/{client_record.pk}")
    assert response.status_code == 200
    assert response.json()["deals"] == []
    assert "Private project" not in response.content.decode()
    assert authenticated_api.get(f"/api/v1/clients/{foreign_client.pk}").status_code == 404
