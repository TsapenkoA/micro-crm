from concurrent.futures import ThreadPoolExecutor

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections
from rest_framework.test import APIClient

from apps.accounts.models import Workspace, WorkspaceMembership
from apps.clients.models import ClientNote

pytestmark = pytest.mark.django_db


@pytest.fixture
def signed_in(api, user):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    response = api.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 200
    return api, response.json()["csrfToken"]


@pytest.mark.parametrize("username", [None, "", "name with spaces", "email@example.com", "<script>", "a" * 151, "ALEX"])
def test_signup_requires_a_valid_unique_username(api, user, username):
    fields = {"email": "new@example.com", "password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"}
    if username is not None:
        fields["username"] = username
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    response = api.post("/api/v1/auth/sign-up", fields, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 400
    assert "username" in response.json()["error"]["details"]
    assert get_user_model().objects.count() == Workspace.objects.count() == 1


def test_profile_renames_generated_personal_workspace_and_preserves_history(signed_in, user, client_record):
    api, token = signed_in
    workspace_id = user.workspace_membership.workspace_id
    note = ClientNote.objects.create(client=client_record, author=user, text="Existing history")
    response = api.patch("/api/v1/auth/profile", {"username": "ChosenName"}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "ChosenName"
    assert response.json()["user"]["workspace"] == {"id": str(workspace_id), "name": "ChosenName's workspace"}
    assert api.get("/api/v1/auth/me").json()["user"]["id"] == user.pk
    assert api.get(f"/api/v1/clients/{client_record.pk}/notes").json()["results"][0]["author"] == {"id": user.pk, "username": "ChosenName"}
    note.refresh_from_db()
    assert note.author_id == user.pk
    assert WorkspaceMembership.objects.get(user=user).workspace_id == workspace_id


@pytest.mark.parametrize("shared", [False, True])
def test_profile_preserves_custom_or_shared_company_names(signed_in, user, other_user, shared):
    api, token = signed_in
    workspace = user.workspace_membership.workspace
    if shared:
        membership = other_user.workspace_membership
        membership.workspace = workspace
        membership.save()
    else:
        workspace.name = "Company name"
        workspace.save()
    original = workspace.name
    assert api.patch("/api/v1/auth/profile", {"username": "ChosenName"}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 200
    workspace.refresh_from_db()
    assert workspace.name == original


def test_profile_enforces_session_csrf_and_origin(api, signed_in, user):
    signed_api, token = signed_in
    anonymous = APIClient(enforce_csrf_checks=True)
    assert anonymous.patch("/api/v1/auth/profile", {"username": "ChosenName"}, format="json").status_code == 403
    assert signed_api.patch("/api/v1/auth/profile", {"username": "ChosenName"}, format="json").status_code == 403
    assert signed_api.patch("/api/v1/auth/profile", {"username": "ChosenName"}, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://untrusted.example").status_code == 403


def test_profile_rejects_taken_username_and_foreign_account_fields(signed_in, user, other_user):
    api, token = signed_in
    response = api.patch("/api/v1/auth/profile", {"username": other_user.username.upper()}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 400
    assert "username" in response.json()["error"]["details"]
    response = api.patch("/api/v1/auth/profile", {"username": "ChosenName", "user_id": other_user.pk, "email": "changed@example.com"}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 400
    user.refresh_from_db()
    other_user.refresh_from_db()
    assert user.username == "alex"
    assert user.email == "alex@example.com"
    assert other_user.username == "other"


@pytest.mark.django_db(transaction=True)
def test_concurrent_signup_cannot_claim_the_same_username_with_different_emails():
    def signup(index):
        close_old_connections()
        try:
            api = APIClient(enforce_csrf_checks=True)
            token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
            fields = {"username": ["SharedName", "sharedname"][index], "email": f"unique{index}@example.com", "password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"}
            return api.post("/api/v1/auth/sign-up", fields, format="json", HTTP_X_CSRFTOKEN=token).status_code
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(signup, range(2)))
    assert sorted(statuses) == [201, 400]
    assert get_user_model().objects.count() == Workspace.objects.count() == WorkspaceMembership.objects.count() == 1
