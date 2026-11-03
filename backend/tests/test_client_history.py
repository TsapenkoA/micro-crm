import uuid
from datetime import datetime, timezone
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.models import WorkspaceMembership
from apps.clients.models import Client, ClientLink, ClientNote

pytestmark = pytest.mark.django_db


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


@pytest.mark.parametrize("text", ["", "   ", None, "a" * 10001])
def test_invalid_notes_are_rejected(history_api, client_record, text):
    response = history_api.post(f"/api/v1/clients/{client_record.pk}/notes", {"text": text}, format="json")
    assert response.status_code == 400
    assert "text" in response.json()["error"]["details"]
    assert not ClientNote.objects.exists()


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,test", "ftp://example.com/file", "file:///C:/secret", "//example.com", "not-a-url", "https://", "https://example.com/" + "a" * 2048])
def test_invalid_or_unsafe_urls_are_rejected(history_api, client_record, url):
    response = history_api.post(f"/api/v1/clients/{client_record.pk}/links", {"label": "Brief", "url": url}, format="json")
    assert response.status_code == 400
    assert "url" in response.json()["error"]["details"]
    assert not ClientLink.objects.exists()


@pytest.mark.parametrize("payload", [{}, {"url": "https://example.com"}, {"label": "", "url": "https://example.com"}, {"label": "a" * 201, "url": "https://example.com"}])
def test_link_required_fields_and_lengths(history_api, client_record, payload):
    assert history_api.post(f"/api/v1/clients/{client_record.pk}/links", payload, format="json").status_code == 400


@pytest.mark.parametrize("relation,payload", [("notes", {"text": "Note"}), ("links", {"label": "Link", "url": "https://example.com"})])
@pytest.mark.parametrize("field", ["author", "author_id", "client", "client_id", "workspace", "created_at", "id", "can_delete", "unexpected"])
def test_identity_and_parent_fields_cannot_be_injected(history_api, client_record, relation, payload, field):
    response = history_api.post(f"/api/v1/clients/{client_record.pk}/{relation}", {**payload, field: str(uuid.uuid4())}, format="json")
    assert response.status_code == 400
    assert field in response.json()["error"]["details"]
    assert not ClientNote.objects.exists()
    assert not ClientLink.objects.exists()


@pytest.mark.parametrize("relation,payload", [("notes", {"text": "Private"}), ("links", {"label": "Private", "url": "https://example.com"})])
def test_foreign_and_missing_parents_are_hidden(history_api, other_user, relation, payload):
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Private")
    ClientNote.objects.create(client=foreign, author=other_user, text="Secret note")
    ClientLink.objects.create(client=foreign, label="Secret link", url="https://example.com")
    for pk in [foreign.pk, uuid.uuid4()]:
        path = f"/api/v1/clients/{pk}/{relation}"
        for response in [history_api.get(path), history_api.post(path, payload, format="json"), history_api.post(path, {}, format="json")]:
            assert response.status_code == 404
            assert "Secret" not in str(response.json())


@pytest.mark.parametrize("relation,payload", [("notes", {"text": "Hello"}), ("links", {"label": "Brief", "url": "http://example.com"})])
def test_history_authentication_csrf_and_membership(api, user, client_record, relation, payload):
    path = f"/api/v1/clients/{client_record.pk}/{relation}"
    assert api.get(path).status_code == 403
    assert api.post(path, payload, format="json").status_code == 403
    api.force_login(user)
    assert api.post(path, payload, format="json").status_code == 403
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert api.post(path, payload, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://untrusted.example").status_code == 403
    WorkspaceMembership.objects.filter(user=user).delete()
    assert api.get(path).status_code == 403


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


def test_model_rejects_non_http_links(client_record):
    with pytest.raises(ValidationError):
        ClientLink.objects.create(client=client_record, label="Unsafe", url="ftp://example.com/file")


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


def test_note_delete_requires_session_csrf_and_membership(api, user, client_record):
    note = ClientNote.objects.create(client=client_record, author=user, text="Keep")
    path = f"/api/v1/clients/{client_record.pk}/notes/{note.pk}"
    assert api.delete(path).status_code == 403
    api.force_login(user)
    assert api.delete(path).status_code == 403
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert api.delete(path, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://untrusted.example").status_code == 403
    WorkspaceMembership.objects.filter(user=user).delete()
    assert api.delete(path, HTTP_X_CSRFTOKEN=token).status_code == 403
    assert ClientNote.objects.filter(pk=note.pk).exists()
