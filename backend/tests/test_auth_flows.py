import datetime
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.utils import timezone
from django.db import close_old_connections, connections
from rest_framework.test import APIClient
from allauth.account.models import EmailAddress
from allauth.socialaccount.models import SocialAccount, SocialLogin

from apps.accounts.models import AuthAttempt, Workspace, WorkspaceMembership

pytestmark = pytest.mark.django_db


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


def test_ambiguous_email_never_selects_an_arbitrary_account(api, user):
    get_user_model().objects.create_user(username="duplicate", email=user.email.upper(), password="test-password-123")
    assert post(api, "login", {"email": user.email, "password": "test-password-123"}).status_code == 403
    assert sign_in(api, user).status_code == 200


def test_throttle_is_persistent_and_recovers_after_window(api, settings):
    settings.AUTH_RATE_LIMITS = {**settings.AUTH_RATE_LIMITS, "login": (2, 300)}
    for _ in range(2):
        assert post(api, "login", {"username": "missing", "password": "wrong"}).status_code == 403
    response = post(api, "login", {"username": "missing", "password": "wrong"})
    assert response.status_code == 429
    assert "Retry-After" in response
    AuthAttempt.objects.update(window_start=timezone.now() - datetime.timedelta(seconds=301))
    assert post(api, "login", {"username": "missing", "password": "wrong"}).status_code == 403


def test_password_change_preserves_current_session(api, user):
    sign_in(api, user)
    fields = {"password": "Changed-secure-pass-123", "password_confirm": "Changed-secure-pass-123"}
    assert post(api, "password", fields).status_code == 400
    assert post(api, "password", {**fields, "current_password": "test-password-123"}).status_code == 200
    assert api.get("/api/v1/auth/me").status_code == 200
    assert post(api, "login", {"email": user.email, "password": "test-password-123"}).status_code == 403


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


def test_unconfigured_provider_has_no_working_action(api, settings):
    settings.SOCIALACCOUNT_PROVIDERS = {name: {} for name in ["google", "github", "microsoft"]}
    assert not any(item["configured"] for item in api.get("/api/v1/auth/providers").json()["providers"])
    assert post(api, "oauth/google/start", {}).status_code == 404
    assert api.get("/api/v1/auth/oauth/google/callback/", {"code": "invalid", "state": "invalid"}).url.endswith("status=failed")


def test_signup_never_joins_a_company_by_email_domain(api):
    fields = {"password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"}
    first = post(api, "sign-up", {**fields, "username": "first", "email": "first@company.example"}).json()["user"]
    second = post(api, "sign-up", {**fields, "username": "second", "email": "second@company.example", "workspace": first["workspace"]["id"]}).json()["user"]
    assert first["workspace"]["id"] != second["workspace"]["id"]
    assert WorkspaceMembership.objects.count() == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_signup_creates_one_account_and_one_workspace():
    def signup():
        close_old_connections()
        try:
            return post(APIClient(enforce_csrf_checks=True), "sign-up", {"username": "concurrent", "email": "concurrent@example.com", "password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"}).status_code
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: signup(), range(2)))
    assert sorted(results) == [201, 400]
    assert get_user_model().objects.count() == Workspace.objects.count() == WorkspaceMembership.objects.count() == 1


def test_reset_rejects_invalid_uid_and_does_not_email_inactive_or_social_only_users(api, user, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    user.set_unusable_password()
    user.save()
    assert post(api, "forgot-password", {"email": user.email}).status_code == 202
    assert len(mail.outbox) == 0
    user.set_password("test-password-123")
    user.is_active = False
    user.save()
    assert post(api, "forgot-password", {"email": user.email}).status_code == 202
    assert len(mail.outbox) == 0
    response = post(api, "reset-password", {"uid": "bm90LWFuLWlk", "token": "invalid", "password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"})
    assert response.status_code == 400


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


def test_social_only_password_and_disconnect_require_recent_auth(api, oauth_settings):
    oauth_roundtrip(api, "google")
    session = api.session
    session["auth_time"] = 0
    session.save()
    fields = {"password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"}
    assert post(api, "password", fields).status_code == 403
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert api.delete("/api/v1/auth/providers/google", HTTP_X_CSRFTOKEN=token).status_code == 403
    assert oauth_roundtrip(api, "google").url.endswith("status=success")
    assert post(api, "password", fields).status_code == 200


def test_inactive_social_account_is_denied(api, user, oauth_settings):
    SocialAccount.objects.create(user=user, provider="google", uid="external-id")
    user.is_active = False
    user.save()
    assert oauth_roundtrip(api, "google").url.endswith("status=failed")
    assert api.get("/api/v1/auth/me").status_code == 403


def test_oauth_start_does_not_accept_external_redirects_and_requires_connect_session(api, oauth_settings):
    assert post(api, "oauth/google/start", {"process": "connect"}).status_code == 403
    assert post(api, "oauth/google/start", {"process": "redirect"}).status_code == 400
    assert post(api, "oauth/google/start", ["invalid-body"]).status_code == 400
    response = post(api, "oauth/google/start", {"next": "https://evil.example"})
    assert "evil.example" not in response.json()["url"]
    assert api.get("/api/v1/auth/oauth/google/start").status_code == 405


def test_historical_social_email_cannot_be_claimed_by_signup_or_another_provider(api, user, oauth_settings):
    EmailAddress.objects.create(user=user, email="alias@example.com", verified=True)
    fields = {"username": "newuser", "email": "alias@example.com", "password": "New-secure-pass-123", "password_confirm": "New-secure-pass-123"}
    assert post(api, "sign-up", fields).status_code == 400
    assert oauth_roundtrip(api, "google", email=fields["email"]).url.endswith("status=account")
    assert not SocialAccount.objects.exists()
    assert get_user_model().objects.count() == 1


@pytest.mark.parametrize("email", ["", "not-an-email"])
def test_social_signup_requires_a_valid_email(api, oauth_settings, email):
    assert oauth_roundtrip(api, "google", email=email).url.endswith("status=failed")
    assert not get_user_model().objects.exists()


def test_reset_mail_failure_does_not_disclose_account_or_transport_details(api, user, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("private SMTP configuration")
    monkeypatch.setattr("apps.accounts.views.send_mail", fail)
    response = post(api, "forgot-password", {"email": user.email})
    assert response.status_code == 202
    assert "private" not in response.content.decode()


def test_oauth_transport_errors_return_a_safe_result(api, oauth_settings):
    from requests.exceptions import RequestException

    with patch("allauth.socialaccount.providers.oauth2.client.OAuth2Client.get_access_token", side_effect=RequestException("private provider error")):
        response = oauth_roundtrip(api, "google")
    assert response.status_code == 302
    assert response.url.endswith("status=failed")
    assert "private" not in response.url
