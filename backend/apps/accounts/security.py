import hashlib
import time
from contextlib import contextmanager

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.throttling import BaseThrottle
from allauth.account.models import EmailAddress

from .models import AuthAttempt


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


class AuthThrottle(BaseThrottle):
    def allow_request(self, request, view):
        scope = getattr(view, "rate_scope", None)
        if not scope or request.method == "GET":
            return True
        limit, seconds = settings.AUTH_RATE_LIMITS[scope]
        identities = ["ip:" + request.META.get("REMOTE_ADDR", "unknown")]
        identifier = (request.data.get("email") or request.data.get("username")) if isinstance(request.data, dict) else None
        if isinstance(identifier, str) and identifier.strip():
            identities.append("account:" + identifier.strip().casefold())
        for identity in identities:
            key = hashlib.sha256(f"{scope}:{identity}".encode()).hexdigest()
            with transaction.atomic():
                row, _ = AuthAttempt.objects.select_for_update().get_or_create(key=key, defaults={"window_start": timezone.now()})
                elapsed = (timezone.now() - row.window_start).total_seconds()
                if elapsed >= seconds:
                    row.window_start, row.attempts, elapsed = timezone.now(), 0, 0
                self.wait_seconds = max(1, seconds - elapsed)
                if row.attempts >= limit:
                    return False
                row.attempts += 1
                row.save(update_fields=["window_start", "attempts"])
        return True

    def wait(self):
        return self.wait_seconds
