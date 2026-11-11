import hashlib
import secrets
from datetime import timedelta

from allauth.account.models import EmailAddress
from django.conf import settings
from django.contrib.auth import get_user_model, login as session_login
from django.contrib.auth.hashers import make_password
from django.core.mail import send_mail
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers, status
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from crm.auth.security import email_in_use, email_lock
from crm.auth.serializers import EmailSerializer, SignupSerializer, UsernameSerializer, VerifyEmailSerializer, check_password
from crm.auth.views import PublicAuthView, user_data
from crm.models import PendingSignup


SIGNUP_MESSAGE = "If this address can be registered, check your email for a verification link."
INVALID_TOKEN = "This verification link is invalid or has expired. Please sign up again."


class VerificationEmailUnavailable(APIException):
    status_code = 503
    default_detail = "Unable to send the verification email. Please try again."


def new_token():
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).hexdigest()


def send_verification(email, token):
    url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    body = f"Verify your MicroFlow email address using this link:\n\n{url}\n\nThis link expires in 24 hours. If you did not request an account, ignore this email."
    try:
        sent = send_mail("Verify your MicroFlow email address", body, settings.DEFAULT_FROM_EMAIL, [email])
    except Exception as exc:
        raise VerificationEmailUnavailable() from exc
    if sent != 1:
        raise VerificationEmailUnavailable()


@method_decorator(csrf_protect, name="dispatch")
class SignupView(PublicAuthView):
    rate_scope = "signup"

    def post(self, request):
        serializer = SignupSerializer(data=request.data, context={"check_username_unique": False})
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        email = fields["email"].casefold()
        username = fields["username"]
        user = get_user_model()(username=username, email=email)
        check_password(fields["password"], user)
        with email_lock(email), email_lock("username:" + username):
            if email_in_use(email):
                return Response({"message": SIGNUP_MESSAGE}, status=202)
            try:
                UsernameSerializer().validate_username(username)
            except serializers.ValidationError as error:
                raise serializers.ValidationError({"username": error.detail})
            if PendingSignup.objects.filter(username__iexact=username, expires_at__gt=timezone.now()).exclude(email=email).exists():
                raise serializers.ValidationError({"username": ["This username is already taken."]})
            pending = PendingSignup.objects.filter(email=email).first()
            token, digest = new_token()
            expires_at = timezone.now() + timedelta(seconds=settings.SIGNUP_VERIFICATION_TIMEOUT)
            if pending:
                pending.username = username
                pending.password_hash = make_password(fields["password"])
                pending.token_hash = digest
                pending.expires_at = expires_at
                pending.save(update_fields=["username", "password_hash", "token_hash", "expires_at"])
            else:
                PendingSignup.objects.create(
                    username=username, email=email, password_hash=make_password(fields["password"]),
                    token_hash=digest, expires_at=expires_at,
                )
            send_verification(email, token)
        return Response({"message": SIGNUP_MESSAGE}, status=202)


@method_decorator(csrf_protect, name="dispatch")
class ResendVerificationView(PublicAuthView):
    rate_scope = "resend"

    def post(self, request):
        serializer = EmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].casefold()
        with email_lock(email):
            pending = PendingSignup.objects.select_for_update().filter(email=email, expires_at__gt=timezone.now()).first()
            if pending and not email_in_use(email):
                token, pending.token_hash = new_token()
                pending.save(update_fields=["token_hash"])
                send_verification(email, token)
        return Response({"message": SIGNUP_MESSAGE}, status=202)


@method_decorator(csrf_protect, name="dispatch")
class VerifyEmailView(PublicAuthView):
    rate_scope = "verify"

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        digest = hashlib.sha256(serializer.validated_data["token"].encode()).hexdigest()
        candidate = PendingSignup.objects.filter(token_hash=digest).values("email", "username").first()
        if not candidate:
            raise serializers.ValidationError({"token": [INVALID_TOKEN]})
        with email_lock(candidate["email"]), email_lock("username:" + candidate["username"]):
            pending = PendingSignup.objects.select_for_update().filter(token_hash=digest).first()
            if not pending or pending.expires_at <= timezone.now() or email_in_use(candidate["email"]):
                raise serializers.ValidationError({"token": [INVALID_TOKEN]})
            if get_user_model().objects.filter(username__iexact=pending.username).exists():
                raise serializers.ValidationError({"token": [INVALID_TOKEN]})
            user = get_user_model()(username=pending.username, email=pending.email, password=pending.password_hash)
            user.save()
            EmailAddress.objects.create(user=user, email=user.email, verified=True, primary=True)
            pending.delete()
        session_login(request, user)
        return Response({"user": user_data(user), "csrfToken": get_token(request)}, status=status.HTTP_201_CREATED)
