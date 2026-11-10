import datetime
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.management import call_command
from django.db import close_old_connections, connections
from django.utils import timezone

import pytest
from allauth.account.models import EmailAddress
from allauth.socialaccount.models import SocialAccount, SocialLogin
from rest_framework.test import APIClient

from crm.models import AuthAttempt, Client, ClientNote, Workspace, WorkspaceMembership

pytestmark = pytest.mark.django_db


def login(api, user):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    return api.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json", HTTP_X_CSRFTOKEN=token)


def test_login_me_logout_and_csrf_rotation(api, user):
    old_token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    old_cookie = api.cookies["csrftoken"].value
    response = login(api, user)
    assert response.status_code == 200
    assert response.json()["user"] == {
        "id": user.pk, "username": user.username, "email": user.email,
        "reporting_currency": "USD",
        "workspace": {"id": str(user.workspace_membership.workspace_id), "name": user.workspace_membership.workspace.name},
    }
    assert api.cookies["csrftoken"].value != old_cookie
    assert api.cookies["sessionid"]["httponly"]
    assert api.get("/api/v1/auth/me").json()["user"] == response.json()["user"]
    assert api.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=old_token).status_code == 403
    token = response.json()["csrfToken"]
    assert api.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=token).status_code == 204
    assert api.get("/api/v1/auth/me").status_code == 403


def test_login_rejects_missing_csrf_even_before_authentication(api, user):
    response = api.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == 403


def test_login_rejects_bad_csrf_and_untrusted_origin(api, user):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    fields = {"username": user.username, "password": "test-password-123"}
    assert api.post("/api/v1/auth/login", fields, format="json", HTTP_X_CSRFTOKEN="invalid").status_code == 403
    assert api.post("/api/v1/auth/login", fields, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://untrusted.example").status_code == 403


def test_invalid_credentials_and_inactive_user(api, user):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    response = api.post("/api/v1/auth/login", {"username": user.username, "password": "incorrect"}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 403
    assert api.get("/api/v1/auth/me").status_code == 403
    user.is_active = False
    user.save()
    assert login(api, user).status_code == 403


def test_session_cannot_be_reused_after_logout(api, user):
    response = login(api, user)
    session_id = api.cookies["sessionid"].value
    api.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=response.json()["csrfToken"])
    api.cookies["sessionid"] = session_id
    assert api.get("/api/v1/auth/me").status_code == 403


def post(api, path, data):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    return api.post("/api/v1/auth/" + path, data, format="json", HTTP_X_CSRFTOKEN=token)


def sign_in(api, user):
    return post(api, "login", {"username": user.username, "password": "test-password-123"})


def test_signup_atomic_personal_workspace_and_email_login(api):
    data = {"username": "newuser", "email": "New@Example.com", "password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"}
    response = post(api, "sign-up", data)
    assert response.status_code == 201
    user = get_user_model().objects.get(email="new@example.com")
    assert WorkspaceMembership.objects.filter(user=user).count() == 1
    assert Workspace.objects.count() == 1
    assert user.username == "newuser"
    assert user.workspace_membership.workspace.name == "newuser's workspace"
    assert api.get("/api/v1/auth/me").json()["user"]["id"] == user.pk
    assert post(api, "login", {"email": "NEW@example.com", "password": data["password"]}).status_code == 200
    assert post(api, "sign-up", data).status_code == 400
    assert get_user_model().objects.count() == 1


def test_signup_failure_rolls_back_user_and_workspace(api, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("provisioning failed")
    monkeypatch.setattr(WorkspaceMembership, "save", fail)
    with pytest.raises(RuntimeError):
        post(api, "sign-up", {"username": "newuser", "email": "new@example.com", "password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"})
    assert get_user_model().objects.count() == 0
    assert Workspace.objects.count() == 0


@pytest.mark.parametrize("data,field", [
    ({"email": "invalid", "password": "Secret-long-123", "password_confirm": "Secret-long-123"}, "email"),
    ({"email": "new@example.com", "password": "password", "password_confirm": "password"}, "password"),
    ({"email": "new@example.com", "password": "Secret-long-123", "password_confirm": "different"}, "password_confirm"),
])
def test_signup_validators(api, data, field):
    response = post(api, "sign-up", {"username": "newuser", **data})
    assert response.status_code == 400
    assert field in response.json()["error"]["details"]
    assert get_user_model().objects.count() == 0


@pytest.mark.parametrize("path", ["sign-up", "forgot-password", "reset-password", "oauth/google/start"])
def test_public_writes_require_csrf(api, path):
    assert api.post("/api/v1/auth/" + path, {}, format="json").status_code == 403
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert api.post("/api/v1/auth/" + path, {}, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://untrusted.example").status_code == 403


def reset_fields():
    url = next(line.strip() for line in mail.outbox[-1].body.splitlines() if line.startswith("http"))
    params = parse_qs(urlparse(url).query)
    return {"uid": params["uid"][0], "token": params["token"][0], "password": "Changed-secure-pass-123", "password_confirm": "Changed-secure-pass-123"}


def test_reset_neutral_response_expiry_reuse_and_session_invalidation(api, user, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    sign_in(api, user)
    session_id = api.cookies["sessionid"].value
    exists = post(api, "forgot-password", {"email": user.email})
    missing = post(api, "forgot-password", {"email": "missing@example.com"})
    assert exists.status_code == missing.status_code == 202
    assert exists.json() == missing.json()
    assert len(mail.outbox) == 1
    fields = reset_fields()
    future = datetime.datetime.now() + datetime.timedelta(seconds=settings.PASSWORD_RESET_TIMEOUT + 5)
    with patch.object(default_token_generator, "_now", return_value=future):
        assert post(api, "reset-password", fields).status_code == 400
    assert post(api, "reset-password", {**fields, "password": "short", "password_confirm": "short"}).status_code == 400
    assert post(api, "reset-password", fields).status_code == 200
    assert post(api, "reset-password", fields).status_code == 400
    api.cookies["sessionid"] = session_id
    assert api.get("/api/v1/auth/me").status_code == 403
    assert post(api, "login", {"email": user.email, "password": fields["password"]}).status_code == 200


def test_throttle_is_persistent_and_recovers_after_window(api, settings):
    settings.AUTH_RATE_LIMITS = {**settings.AUTH_RATE_LIMITS, "login": (2, 300)}
    for _ in range(2):
        assert post(api, "login", {"username": "missing", "password": "wrong"}).status_code == 403
    response = post(api, "login", {"username": "missing", "password": "wrong"})
    assert response.status_code == 429
    assert "Retry-After" in response
    AuthAttempt.objects.update(window_start=timezone.now() - datetime.timedelta(seconds=301))
    assert post(api, "login", {"username": "missing", "password": "wrong"}).status_code == 403


@pytest.fixture
def oauth_settings(settings, monkeypatch):
    settings.SOCIALACCOUNT_PROVIDERS = {name: {**config, "APPS": [{"client_id": "test-client", "secret": "test-secret", "key": ""}]}
                                         for name, config in settings.SOCIALACCOUNT_PROVIDERS.items()}
    monkeypatch.setattr("allauth.socialaccount.providers.oauth2.client.OAuth2Client.get_access_token", lambda *args, **kwargs: {"access_token": "mock-token", "token_type": "Bearer"})
    return settings


def oauth_roundtrip(api, provider, uid="external-id", email="social@example.com", process="login"):
    response = post(api, f"oauth/{provider}/start", {"process": process})
    assert response.status_code == 200, response.content
    params = parse_qs(urlparse(response.json()["url"]).query)
    assert params["code_challenge_method"] == ["S256"]
    assert "state" in params
    callback = urlparse(params["redirect_uri"][0]).path
    def complete(adapter, request, app, token, **kwargs):
        return SocialLogin(provider=adapter.get_provider(), user=get_user_model()(email=email), account=SocialAccount(provider=provider, uid=uid),
                           email_addresses=[EmailAddress(email=email, verified=True, primary=True)])
    classes = {"google": "google.views.GoogleOAuth2Adapter", "github": "github.views.GitHubOAuth2Adapter", "microsoft": "microsoft.views.MicrosoftGraphOAuth2Adapter"}
    with patch("allauth.socialaccount.providers." + classes[provider] + ".complete_login", complete):
        return api.get(callback, {"code": "mock-code", "state": params["state"][0]})


@pytest.mark.parametrize("provider", ["google", "github", "microsoft"])
def test_oauth_callback_signup_repeat_and_invalid_state(api, oauth_settings, provider):
    response = oauth_roundtrip(api, provider)
    assert response.status_code == 302
    assert response.url.endswith("/oauth-result?status=success"), response.url
    user = get_user_model().objects.get(email="social@example.com")
    workspace = user.workspace_membership.workspace_id
    assert not user.has_usable_password()
    assert oauth_roundtrip(api, provider).url.endswith("status=success")
    assert get_user_model().objects.count() == 1
    assert WorkspaceMembership.objects.get(user=user).workspace_id == workspace
    invalid = api.get(f"/api/v1/auth/oauth/{provider}/callback/", {"code": "bad", "state": "invalid"})
    assert invalid.status_code == 302
    assert invalid.url.endswith("status=failed")
    replay = api.get(response.request["PATH_INFO"] + "?" + response.request["QUERY_STRING"])
    assert replay.status_code == 302
    assert replay.url.endswith("status=failed")


def test_oauth_email_collision_does_not_merge_and_explicit_connect_works(api, user, oauth_settings):
    assert oauth_roundtrip(api, "google", email=user.email).url.endswith("status=account")
    assert not SocialAccount.objects.exists()
    assert sign_in(api, user).status_code == 200
    assert oauth_roundtrip(api, "google", email=user.email, process="connect").url.endswith("status=connected")
    assert SocialAccount.objects.get().user_id == user.pk
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert api.delete("/api/v1/auth/providers/google", HTTP_X_CSRFTOKEN=token).status_code == 204


def test_social_only_cannot_disconnect_last_method_and_can_set_password(api, oauth_settings):
    oauth_roundtrip(api, "google")
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert api.delete("/api/v1/auth/providers/google", HTTP_X_CSRFTOKEN=token).status_code == 400
    assert post(api, "password", {"password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"}).status_code == 200
    assert api.delete("/api/v1/auth/providers/google", HTTP_X_CSRFTOKEN=token).status_code == 204


def test_connect_requires_recent_auth_and_never_steals_another_users_provider(api, user, other_user, oauth_settings):
    SocialAccount.objects.create(user=other_user, provider="google", uid="external-id")
    sign_in(api, user)
    assert oauth_roundtrip(api, "google", process="connect").url.endswith("status=failed")
    assert SocialAccount.objects.get().user_id == other_user.pk
    session = api.session
    session["auth_time"] = 0
    session.save()
    assert post(api, "oauth/github/start", {"process": "connect"}).status_code == 403
    assert post(api, "reauthenticate", {"password": "wrong"}).status_code == 403
    assert post(api, "reauthenticate", ["invalid-body"]).status_code == 403
    assert post(api, "reauthenticate", {"password": "test-password-123"}).status_code == 200
    assert api.get("/api/v1/auth/methods").json()["recent_auth"]


def test_password_change_invalidates_other_sessions_and_checks_strength(api, user):
    sign_in(api, user)
    other = APIClient(enforce_csrf_checks=True)
    sign_in(other, user)
    fields = {"current_password": "test-password-123", "password": "short", "password_confirm": "short"}
    assert post(api, "password", fields).status_code == 400
    fields.update(password="Changed-secure-pass-123", password_confirm="Changed-secure-pass-123")
    assert post(api, "password", fields).status_code == 200
    assert api.get("/api/v1/auth/me").status_code == 200
    assert other.get("/api/v1/auth/me").status_code == 403


def test_reset_mail_failure_does_not_disclose_account_or_transport_details(api, user, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("private SMTP configuration")
    monkeypatch.setattr("crm.auth.views.send_mail", fail)
    response = post(api, "forgot-password", {"email": user.email})
    assert response.status_code == 202
    assert "private" not in response.content.decode()


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


@pytest.fixture
def google_settings(settings):
    settings.SOCIALACCOUNT_PROVIDERS = {
        **settings.SOCIALACCOUNT_PROVIDERS,
        "google": {"SCOPE": ["openid", "email", "profile"], "OAUTH_PKCE_ENABLED": True,
                   "APPS": [{"client_id": "google-test-client", "secret": "test-secret", "key": ""}]},
    }


def google_post(api, path, data):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    return api.post("/api/v1/" + path, data, format="json", HTTP_X_CSRFTOKEN=token)


def google_callback(api, email, uid="google-user-123", source="id_token", process="login"):
    response = google_post(api, "auth/oauth/google/start", {"process": process})
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
    own_client = google_post(api, "clients", {"name": "Google user's client"})
    assert own_client.status_code == 201
    assert own_client.json()["workspace"] == str(membership.workspace_id)
    assert google_post(api, "auth/logout", {}).status_code == 204
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
    assert google_post(api, "auth/login", {"username": user.username, "password": "test-password-123"}).status_code == 200
    assert google_callback(api, user.email, source=source, process="connect").url.endswith("status=connected")
    assert SocialAccount.objects.get(provider="google").user_id == user.pk
    assert google_post(api, "auth/logout", {}).status_code == 204
    assert google_callback(api, user.email, source=source).url.endswith("status=success")
    assert api.get("/api/v1/auth/me").json()["user"]["id"] == user.pk
    assert api.get(f"/api/v1/clients/{client_record.pk}").status_code == 200
    assert get_user_model().objects.count() == 2
    assert Client.objects.filter(pk=client_record.pk).values().get() == before_client
    assert list(WorkspaceMembership.objects.order_by("pk").values()) == before_memberships
