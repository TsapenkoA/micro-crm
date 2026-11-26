import hashlib
import time
from contextlib import contextmanager
from ipaddress import ip_address, ip_network

from allauth.account.models import EmailAddress
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.throttling import BaseThrottle

from crm.models import AuthAttempt


def recent_auth(request):
    return (request.user.is_authenticated and request.session.get("reauth_user") == str(request.user.pk)
            and 0 <= time.time() - request.session.get("auth_time", 0) < settings.AUTH_REAUTH_SECONDS)


@contextmanager
def email_lock(email):
    key = int.from_bytes(hashlib.sha256(email.casefold().encode()).digest()[:8], "big", signed=True)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [key])
        yield


def email_user(email):
    users = list(get_user_model().objects.filter(email__iexact=email)[:2])
    return users[0] if len(users) == 1 else None


def email_in_use(email):
    return get_user_model().objects.filter(email__iexact=email).exists() or EmailAddress.objects.filter(email__iexact=email).exists()


def client_ip(request):
    remote = request.META.get("REMOTE_ADDR", "unknown")
    try:
        trusted = any(ip_address(remote) in ip_network(network) for network in settings.TRUSTED_PROXY_IPS)
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")
        count = settings.TRUSTED_PROXY_COUNT
        if trusted and count > 0 and len(forwarded) >= count:
            return str(ip_address(forwarded[-count].strip()))
    except ValueError:
        pass
    return remote


def attempt_key(scope, identity):
    return hashlib.sha256(f"{scope}:{identity}".encode()).hexdigest()


def login_identity(request):
    identifier = (request.data.get("email") or request.data.get("username")) if isinstance(request.data, dict) else None
    if isinstance(identifier, str) and identifier.strip():
        return f"account:{identifier.strip().casefold()}:ip:{client_ip(request)}"
    return None


def clear_login_attempts(request):
    identity = login_identity(request)
    if identity:
        AuthAttempt.objects.filter(key=attempt_key("login", identity)).delete()


class AuthThrottle(BaseThrottle):
    def allow_request(self, request, view):
        scope = getattr(view, "rate_scope", None)
        if not scope or request.method == "GET":
            return True
        limit, seconds = settings.AUTH_RATE_LIMITS[scope]
        identities = [("ip:" + client_ip(request), limit * 10 if scope in {"login", "forgot"} else limit)]
        identity = login_identity(request)
        if identity:
            identities.append((identity, limit))
        if request.user.is_authenticated:
            identities.append((f"user:{request.user.pk}", limit))
        return self.check_limits(scope, seconds, identities)

    def check_limits(self, scope, seconds, identities):
        for identity, quota in identities:
            key = attempt_key(scope, identity)
            with transaction.atomic():
                row, _ = AuthAttempt.objects.select_for_update().get_or_create(key=key, defaults={"window_start": timezone.now()})
                elapsed = (timezone.now() - row.window_start).total_seconds()
                if elapsed >= seconds:
                    row.window_start, row.attempts, elapsed = timezone.now(), 0, 0
                self.wait_seconds = max(1, seconds - elapsed)
                if row.attempts >= quota:
                    return False
                row.attempts += 1
                row.save(update_fields=["window_start", "attempts"])
        return True

    def wait(self):
        return self.wait_seconds


class InvoiceEmailThrottle(AuthThrottle):
    def allow_request(self, request, view):
        if request.method != "POST":
            return True
        scope = "invoice_email"
        limit, seconds = settings.AUTH_RATE_LIMITS[scope]
        return self.check_limits(scope, seconds, [
            (f"user:{request.user.pk}", limit), (f"workspace:{request.workspace_id}", limit * 5),
        ])
