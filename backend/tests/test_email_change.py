from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from allauth.account.models import EmailAddress
from allauth.socialaccount.models import SocialAccount
from django.core import mail
from django.utils import timezone

from crm.models import PendingEmailChange, WorkspaceMembership


pytestmark = pytest.mark.django_db


def post(api, path, data):
    csrf = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    return api.post("/api/v1/auth/" + path, data, format="json", HTTP_X_CSRFTOKEN=csrf)


def token_from_message():
    url = next(line for line in mail.outbox[-1].body.splitlines() if line.startswith("http"))
    return parse_qs(urlparse(url).fragment.split("?", 1)[1])["email_change_token"][0]


def test_email_change_requires_recent_auth_and_verifies_new_address(api, user, settings, django_capture_on_commit_callbacks):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    api.force_login(user)
    session = api.session
    session["auth_time"] = 0
    session.save()
    old_workspace = WorkspaceMembership.objects.get(user=user).workspace_id
    assert post(api, "email-change", {"email": "new@example.com"}).status_code == 403
    assert post(api, "reauthenticate", {"password": "test-password-123"}).status_code == 200
    assert post(api, "email-change", {"email": "New@Example.com"}).status_code == 202
    pending = PendingEmailChange.objects.get(user=user)
    token = token_from_message()
    assert pending.email == "new@example.com" and token not in pending.token_hash
    assert user.email == "alex@example.com"
    assert post(api, "email-change/confirm", {"token": "invalid"}).status_code == 400
    with django_capture_on_commit_callbacks(execute=True):
        response = post(api, "email-change/confirm", {"token": token})
    assert response.status_code == 200 and response.json()["user"]["email"] == "new@example.com"
    user.refresh_from_db()
    assert user.email == "new@example.com"
    assert EmailAddress.objects.get(user=user).email == "new@example.com"
    assert mail.outbox[-1].to == ["alex@example.com"]
    assert mail.outbox[-1].subject == "Your MicroFlow email address changed"
    assert not PendingEmailChange.objects.filter(user=user).exists()
    assert WorkspaceMembership.objects.get(user=user).workspace_id == old_workspace
    assert post(api, "email-change/confirm", {"token": token}).status_code == 400


def test_email_change_rejects_existing_local_and_oauth_addresses(api, user, other_user, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    other_user.email = "oauth@example.com"
    other_user.save(update_fields=["email"])
    SocialAccount.objects.create(user=other_user, provider="google", uid="other-google")
    EmailAddress.objects.create(user=other_user, email=other_user.email, verified=True, primary=True)
    api.force_login(user)
    post(api, "reauthenticate", {"password": "test-password-123"})
    assert post(api, "email-change", {"email": "oauth@example.com"}).status_code == 400
    assert post(api, "email-change", {"email": "alex@example.com"}).status_code == 400
    assert not PendingEmailChange.objects.exists()
    assert not mail.outbox


def test_expired_email_change_does_not_replace_account(api, user, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    api.force_login(user)
    post(api, "reauthenticate", {"password": "test-password-123"})
    assert post(api, "email-change", {"email": "next@example.com"}).status_code == 202
    token = token_from_message()
    PendingEmailChange.objects.filter(user=user).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert post(api, "email-change/confirm", {"token": token}).status_code == 400
    user.refresh_from_db()
    assert user.email == "alex@example.com"


def test_expired_pending_address_can_be_requested_by_another_account(api, user, other_user, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    PendingEmailChange.objects.create(user=other_user, email="available@example.com", token_hash="a" * 64,
                                      expires_at=timezone.now() - timedelta(seconds=1))
    api.force_login(user)
    assert post(api, "reauthenticate", {"password": "test-password-123"}).status_code == 200
    assert post(api, "email-change", {"email": "available@example.com"}).status_code == 202
    assert PendingEmailChange.objects.get(email="available@example.com").user_id == user.pk
