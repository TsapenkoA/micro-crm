import uuid
from datetime import datetime, timedelta, timezone
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command

import pytest
from rest_framework.test import APIClient

from crm.models import Client, ClientLink, ClientNote, Deal, Invoice, WorkspaceMembership

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


def test_detail_returns_related_workspace_deals(authenticated_api, user, colleague, client_record):
    deadline = datetime(2026, 12, 1, 12, tzinfo=timezone.utc)
    deal = Deal.objects.create(workspace=client_record.workspace, created_by=colleague, client=client_record, title="Shared project", amount="123.45", currency="EUR", deadline=deadline)
    unrelated = Client.objects.create(workspace=client_record.workspace, created_by=user, name="Other client")
    Deal.objects.create(workspace=client_record.workspace, created_by=user, client=unrelated, title="Other project", amount=1, currency="EUR")
    response = authenticated_api.get(f"/api/v1/clients/{client_record.pk}")
    assert response.status_code == 200
    assert response.json()["deals"] == [{"id": str(deal.pk), "title": "Shared project", "status": "new_lead", "amount": "123.45", "currency": "EUR", "deadline": "2026-12-01T12:00:00Z"}]


@pytest.fixture
def history_api(api, user):
    api.force_login(user)
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    api.credentials(HTTP_X_CSRFTOKEN=token)
    return api


def test_note_dto_preserves_plain_text_and_server_author(history_api, user, client_record):
    text = '<script>alert("xss")</script>\nA shared note'
    path = f"/api/v1/clients/{client_record.pk}/notes"
    response = history_api.post(path, {"text": text}, format="json")
    assert response.status_code == 201
    data = response.json()
    assert data["author"] == {"id": user.pk, "username": user.username}
    assert data["client"] == str(client_record.pk)
    assert data["text"] == text
    assert data["created_at"].endswith("Z")
    assert ClientNote.objects.get(pk=data["id"]).text == text
    assert history_api.get(path).json()["results"] == [data]


def test_link_dto_and_persistence(history_api, client_record):
    path = f"/api/v1/clients/{client_record.pk}/links"
    response = history_api.post(path, {"label": "Figma brief", "url": "https://www.figma.com/design/example"}, format="json")
    assert response.status_code == 201
    data = response.json()
    assert set(data) == {"id", "client", "label", "url", "created_at"}
    assert data["client"] == str(client_record.pk)
    assert data["label"] == "Figma brief"
    assert history_api.get(path).json()["results"] == [data]
    assert ClientLink.objects.get(pk=data["id"]).url == data["url"]


@pytest.mark.parametrize("relation", ["notes", "links"])
def test_empty_history_and_stable_chronological_pagination(history_api, user, client_record, relation):
    path = f"/api/v1/clients/{client_record.pk}/{relation}"
    assert history_api.get(path).json() == {"count": 0, "next": None, "previous": None, "results": []}
    Model = ClientNote if relation == "notes" else ClientLink
    timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for number in [3, 1, 2]:
        fields = {"author": user, "text": str(number)} if relation == "notes" else {"label": str(number), "url": "http://example.com"}
        row = Model.objects.create(id=uuid.UUID(int=number), client=client_record, **fields)
        Model.objects.filter(pk=row.pk).update(created_at=timestamp)
    first = history_api.get(path, {"page_size": 2}).json()
    second = history_api.get(path, {"page_size": 2, "page": 2}).json()
    assert first["count"] == second["count"] == 3
    assert first["next"] and second["previous"]
    assert [row["id"] for row in first["results"] + second["results"]] == [str(uuid.UUID(int=number)) for number in [1, 2, 3]]


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,test", "ftp://example.com/file", "file:///C:/secret", "//example.com", "not-a-url", "https://", "https://example.com/" + "a" * 2048])
def test_invalid_or_unsafe_urls_are_rejected(history_api, client_record, url):
    response = history_api.post(f"/api/v1/clients/{client_record.pk}/links", {"label": "Brief", "url": url}, format="json")
    assert response.status_code == 400
    assert "url" in response.json()["error"]["details"]
    assert not ClientLink.objects.exists()


@pytest.mark.parametrize("relation,payload", [("notes", {"text": "Note"}), ("links", {"label": "Link", "url": "https://example.com"})])
@pytest.mark.parametrize("field", ["author", "author_id", "client", "client_id", "workspace", "created_at", "id", "can_delete", "unexpected"])
def test_identity_and_parent_fields_cannot_be_injected(history_api, client_record, relation, payload, field):
    response = history_api.post(f"/api/v1/clients/{client_record.pk}/{relation}", {**payload, field: str(uuid.uuid4())}, format="json")
    assert response.status_code == 400
    assert field in response.json()["error"]["details"]
    assert not ClientNote.objects.exists()
    assert not ClientLink.objects.exists()


def test_colleagues_share_notes_and_links_but_other_companies_do_not(history_api, user, other_user, client_record):
    call_command("assign_workspace", other_user.username, str(client_record.workspace_id), stdout=StringIO())
    path = f"/api/v1/clients/{client_record.pk}"
    first = history_api.post(path + "/notes", {"text": "From Alex"}, format="json").json()
    history_api.post(path + "/links", {"label": "Shared brief", "url": "https://example.com"}, format="json")
    colleague = APIClient()
    colleague.force_authenticate(user=other_user)
    assert colleague.get(path + "/notes").json()["results"] == [{**first, "can_delete": False}]
    second = colleague.post(path + "/notes", {"text": "From colleague"}, format="json")
    assert second.status_code == 201
    assert second.json()["author"]["id"] == other_user.pk
    assert len(history_api.get(path + "/notes").json()["results"]) == 2
    assert colleague.get(path + "/links").json()["results"][0]["label"] == "Shared brief"
    outsider = get_user_model().objects.create_user(username="outsider")
    colleague.force_authenticate(user=outsider)
    assert colleague.get(path + "/notes").status_code == 404
    assert colleague.get(path + "/links").status_code == 404


def test_author_can_delete_note_without_deleting_other_records(history_api, user, client_record):
    note = ClientNote.objects.create(client=client_record, author=user, text="Remove this")
    retained = ClientNote.objects.create(client=client_record, author=user, text="Keep this")
    link = ClientLink.objects.create(client=client_record, label="Keep link", url="https://example.com")
    path = f"/api/v1/clients/{client_record.pk}/notes/{note.pk}"
    assert history_api.delete(path).status_code == 204
    assert not ClientNote.objects.filter(pk=note.pk).exists()
    assert ClientNote.objects.filter(pk=retained.pk).exists()
    assert ClientLink.objects.filter(pk=link.pk).exists()
    assert Client.objects.filter(pk=client_record.pk).exists()
    assert history_api.delete(path).status_code == 404


@pytest.mark.parametrize("superuser", [False, True])
def test_colleague_cannot_delete_another_authors_note(history_api, user, other_user, client_record, superuser):
    call_command("assign_workspace", other_user.username, str(client_record.workspace_id), stdout=StringIO())
    other_user.is_superuser = superuser
    other_user.save()
    note = ClientNote.objects.create(client=client_record, author=user, text="Author only")
    api = APIClient()
    api.force_authenticate(user=other_user)
    path = f"/api/v1/clients/{client_record.pk}/notes"
    assert history_api.get(path).json()["results"][0]["can_delete"] is True
    assert api.get(path).json()["results"][0]["can_delete"] is False
    response = api.delete(f"{path}/{note.pk}")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == 403
    assert ClientNote.objects.filter(pk=note.pk).exists()


def test_note_delete_hides_foreign_wrong_parent_and_missing_ids(history_api, user, other_user, client_record):
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Foreign")
    note = ClientNote.objects.create(client=foreign, author=other_user, text="Private")
    own_note = ClientNote.objects.create(client=client_record, author=user, text="Own")
    for client_id, note_id in [(foreign.pk, note.pk), (client_record.pk, note.pk), (foreign.pk, own_note.pk), (client_record.pk, uuid.uuid4()), (uuid.uuid4(), own_note.pk)]:
        response = history_api.delete(f"/api/v1/clients/{client_id}/notes/{note_id}")
        assert response.status_code == 404
        assert "Private" not in str(response.json())
    assert ClientNote.objects.count() == 2
