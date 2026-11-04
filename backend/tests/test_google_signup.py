from io import StringIO
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from allauth.account.models import EmailAddress
from allauth.socialaccount.models import SocialAccount

from apps.accounts.models import Workspace, WorkspaceMembership
from apps.clients.models import Client

pytestmark = pytest.mark.django_db


@pytest.fixture
def google_settings(settings):
    settings.SOCIALACCOUNT_PROVIDERS = {
        **settings.SOCIALACCOUNT_PROVIDERS,
        "google": {"SCOPE": ["openid", "email", "profile"], "OAUTH_PKCE_ENABLED": True,
                   "APPS": [{"client_id": "google-test-client", "secret": "test-secret", "key": ""}]},
    }


def post(api, path, data):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    return api.post("/api/v1/" + path, data, format="json", HTTP_X_CSRFTOKEN=token)


def google_callback(api, email, uid="google-user-123", source="id_token", process="login"):
    response = post(api, "auth/oauth/google/start", {"process": process})
    assert response.status_code == 200
    params = parse_qs(urlparse(response.json()["url"]).query)
    profile = {"email": email, "given_name": "Google", "family_name": "Tester", "name": "Google Tester"}
    tokens = {"access_token": "mock-access-token", "token_type": "Bearer"}
    if source == "id_token":
        profile.update(sub=uid, email_verified=True, iss="https://accounts.google.com", aud="google-test-client")
        tokens["id_token"] = "mock-id-token"
        boundary = "_decode_id_token"
    else:
        profile.update(id=uid, verified_email=True)
        boundary = "_fetch_user_info"
    with patch("allauth.socialaccount.providers.oauth2.client.OAuth2Client.get_access_token", return_value=tokens) as exchange, patch(
        "allauth.socialaccount.providers.google.views.GoogleOAuth2Adapter." + boundary, return_value=profile
    ) as claims:
        result = api.get(urlparse(params["redirect_uri"][0]).path, {"code": "mock-code", "state": params["state"][0]})
    exchange.assert_called_once()
    claims.assert_called_once()
    return result


@pytest.mark.parametrize("source", ["id_token", "userinfo"])
def test_new_google_profile_creates_complete_account_and_repeat_login_is_stable(api, other_user, google_settings, source):
    foreign = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Other company")
    counts = [get_user_model().objects.count(), Workspace.objects.count(), WorkspaceMembership.objects.count()]
    response = google_callback(api, "new.google@example.com", source=source)
    assert response.status_code == 302
    assert response.url.endswith("/oauth-result?status=success")
    user = get_user_model().objects.get(email="new.google@example.com")
    membership = WorkspaceMembership.objects.get(user=user)
    assert membership.workspace_id != other_user.workspace_membership.workspace_id
    assert not user.has_usable_password()
    assert [get_user_model().objects.count(), Workspace.objects.count(), WorkspaceMembership.objects.count()] == [count + 1 for count in counts]
    assert SocialAccount.objects.get(provider="google", uid="google-user-123").user_id == user.pk
    assert EmailAddress.objects.get(user=user, email=user.email).verified
    assert api.get("/api/v1/auth/me").json()["user"]["id"] == user.pk
    assert api.get(f"/api/v1/clients/{foreign.pk}").status_code == 404
    own_client = post(api, "clients", {"name": "Google user's client"})
    assert own_client.status_code == 201
    assert own_client.json()["workspace"] == str(membership.workspace_id)
    assert post(api, "auth/logout", {}).status_code == 204
    assert google_callback(api, user.email, source=source).url.endswith("status=success")
    assert api.get("/api/v1/auth/me").json()["user"]["id"] == user.pk
    assert WorkspaceMembership.objects.get(user=user).workspace_id == membership.workspace_id
    assert SocialAccount.objects.filter(provider="google").count() == 1
    assert [get_user_model().objects.count(), Workspace.objects.count(), WorkspaceMembership.objects.count()] == [count + 1 for count in counts]
    assert api.get(f"/api/v1/clients/{own_client.json()['id']}").status_code == 200


@pytest.mark.parametrize("source", ["id_token", "userinfo"])
def test_google_email_collision_preserves_existing_company_until_explicit_connection(api, user, other_user, client_record, google_settings, source):
    call_command("assign_workspace", other_user.username, str(user.workspace_membership.workspace_id), stdout=StringIO())
    before_user = get_user_model().objects.filter(pk=user.pk).values().get()
    before_client = Client.objects.filter(pk=client_record.pk).values().get()
    before_memberships = list(WorkspaceMembership.objects.order_by("pk").values())
    response = google_callback(api, user.email.upper(), source=source)
    assert response.status_code == 302
    assert response.url.endswith("status=account")
    assert api.get("/api/v1/auth/me").status_code == 403
    assert api.get(f"/api/v1/clients/{client_record.pk}").status_code == 403
    assert not SocialAccount.objects.exists()
    assert not EmailAddress.objects.exists()
    assert get_user_model().objects.filter(pk=user.pk).values().get() == before_user
    assert Client.objects.filter(pk=client_record.pk).values().get() == before_client
    assert list(WorkspaceMembership.objects.order_by("pk").values()) == before_memberships
    assert post(api, "auth/login", {"username": user.username, "password": "test-password-123"}).status_code == 200
    assert google_callback(api, user.email, source=source, process="connect").url.endswith("status=connected")
    assert SocialAccount.objects.get(provider="google").user_id == user.pk
    assert post(api, "auth/logout", {}).status_code == 204
    assert google_callback(api, user.email, source=source).url.endswith("status=success")
    assert api.get("/api/v1/auth/me").json()["user"]["id"] == user.pk
    assert api.get(f"/api/v1/clients/{client_record.pk}").status_code == 200
    assert get_user_model().objects.count() == 2
    assert Client.objects.filter(pk=client_record.pk).values().get() == before_client
    assert list(WorkspaceMembership.objects.order_by("pk").values()) == before_memberships


def test_existing_google_uid_cannot_switch_to_another_workspace_by_changing_email(api, user, client_record, google_settings):
    assert google_callback(api, "original.google@example.com").url.endswith("status=success")
    owner = get_user_model().objects.get(email="original.google@example.com")
    workspace_id = owner.workspace_membership.workspace_id
    assert post(api, "auth/logout", {}).status_code == 204
    assert google_callback(api, user.email).url.endswith("status=success")
    assert api.get("/api/v1/auth/me").json()["user"]["id"] == owner.pk
    assert WorkspaceMembership.objects.get(user=owner).workspace_id == workspace_id
    assert api.get(f"/api/v1/clients/{client_record.pk}").status_code == 404
    user.refresh_from_db()
    assert user.username == "alex"
    assert not SocialAccount.objects.filter(user=user).exists()


def test_different_google_uid_with_same_email_cannot_claim_an_existing_google_account(api, google_settings):
    assert google_callback(api, "original.google@example.com").url.endswith("status=success")
    owner = get_user_model().objects.get()
    workspace_id = owner.workspace_membership.workspace_id
    assert post(api, "auth/logout", {}).status_code == 204
    assert google_callback(api, owner.email, uid="different-google-user").url.endswith("status=account")
    assert api.get("/api/v1/auth/me").status_code == 403
    assert get_user_model().objects.count() == Workspace.objects.count() == WorkspaceMembership.objects.count() == 1
    assert SocialAccount.objects.get().uid == "google-user-123"
    assert WorkspaceMembership.objects.get(user=owner).workspace_id == workspace_id


def test_google_signup_provisioning_failure_rolls_back_every_record(api, google_settings, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("provisioning failed")
    monkeypatch.setattr(WorkspaceMembership, "save", fail)
    with pytest.raises(RuntimeError, match="provisioning failed"):
        google_callback(api, "new.google@example.com")
    assert get_user_model().objects.count() == Workspace.objects.count() == WorkspaceMembership.objects.count() == 0
    assert not SocialAccount.objects.exists()
    assert not EmailAddress.objects.exists()
