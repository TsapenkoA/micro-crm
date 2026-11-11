import logging
import time
import uuid
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login as session_login, logout as session_logout, update_session_auth_hash
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_protect
from allauth.socialaccount.models import SocialAccount
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from crm.api.permissions import IsWorkspaceMember
from crm.auth.security import AuthThrottle, email_in_use, email_lock, email_user, recent_auth
from crm.auth.serializers import LoginSerializer, SignupSerializer, EmailSerializer, ResetSerializer, UsernameSerializer, NewPasswordSerializer, check_password
from crm.models import UserAvatar, Workspace, WorkspaceMembership
from crm.services.fx import ECB_CURRENCIES

logger = logging.getLogger(__name__)


def user_data(user):
    membership = WorkspaceMembership.objects.select_related("workspace").filter(user=user).first()
    workspace = {"id": str(membership.workspace_id), "name": membership.workspace.name} if membership else None
    avatar_updated = UserAvatar.objects.filter(user=user).values_list("updated_at", flat=True).first()
    avatar_url = f"/api/v1/auth/avatar?v={avatar_updated.timestamp()}" if avatar_updated else None
    return {"id": user.pk, "username": user.username, "email": user.email, "workspace": workspace, "reporting_currency": membership.reporting_currency if membership else "USD", "avatar_url": avatar_url}


@api_view(["GET"])
@permission_classes([AllowAny])
def csrf(request):
    return Response({"csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class PublicAuthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [AuthThrottle]


class LoginView(PublicAuthView):
    rate_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        identifier = fields.get("email") or fields["username"]
        candidate = email_user(identifier) if "@" in identifier else None
        username = candidate.username if candidate else (uuid.uuid4().hex if "@" in identifier else identifier)
        user = authenticate(request, username=username, password=fields["password"])
        if user is None:
            return Response({"error": {"code": 403, "details": "Invalid credentials."}}, status=403)
        session_login(request, user)
        return Response({"user": user_data(user), "csrfToken": get_token(request)})


login = LoginView.as_view()


@api_view(["POST"])
def logout(request):
    session_logout(request)
    return Response(status=204)


@api_view(["GET"])
def me(request):
    return Response({"user": user_data(request.user)})


@method_decorator(csrf_protect, name="dispatch")
class SignupView(PublicAuthView):
    rate_scope = "signup"

    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        email = fields["email"].casefold()
        if len(email) > 254:
            raise serializers.ValidationError({"email": ["Use 254 characters or fewer."]})
        User = get_user_model()
        with email_lock(email), email_lock("username:" + fields["username"]):
            if email_in_use(email):
                raise serializers.ValidationError({"email": ["Unable to create an account with these details. Try signing in or resetting your password."]})
            try:
                username = serializer.validate_username(fields["username"])
            except serializers.ValidationError as error:
                raise serializers.ValidationError({"username": error.detail})
            user = User(username=username, email=email)
            check_password(fields["password"], user)
            user.set_password(fields["password"])
            user.save()
        session_login(request, user)
        return Response({"user": user_data(user), "csrfToken": get_token(request)}, status=201)


@method_decorator(csrf_protect, name="dispatch")
class ForgotPasswordView(PublicAuthView):
    rate_scope = "forgot"

    def post(self, request):
        serializer = EmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = email_user(serializer.validated_data["email"])
        if user and user.is_active and user.has_usable_password():
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            url = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
            body = f"Reset your Micro-CRM password using this link:\n\n{url}\n\nThis link expires in one hour. If you did not request a reset, ignore this email."
            try:
                send_mail("Reset your Micro-CRM password", body, settings.DEFAULT_FROM_EMAIL, [user.email])
            except Exception:
                logger.warning("Password reset email could not be sent.")
        return Response({"message": "If an eligible account exists, password reset instructions will be sent."}, status=202)


@method_decorator(csrf_protect, name="dispatch")
class ResetPasswordView(PublicAuthView):
    rate_scope = "reset"

    def post(self, request):
        serializer = ResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        with transaction.atomic():
            try:
                pk = urlsafe_base64_decode(fields["uid"]).decode()
                user = get_user_model().objects.select_for_update().get(pk=pk, is_active=True)
            except (ValueError, UnicodeDecodeError, OverflowError, get_user_model().DoesNotExist):
                user = None
            if not user or not user.has_usable_password() or not default_token_generator.check_token(user, fields["token"]):
                raise serializers.ValidationError({"token": ["This reset link is invalid or has expired. Request a new link."]})
            check_password(fields["password"], user)
            user.set_password(fields["password"])
            user.save(update_fields=["password"])
        session_logout(request)
        return Response({"message": "Password updated. Sign in with your new password."})


class SecurityView(APIView):
    throttle_classes = [AuthThrottle]
    rate_scope = "security"


class ProfileView(SecurityView):
    def patch(self, request):
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            serializer = UsernameSerializer(user, data=request.data)
            serializer.is_valid(raise_exception=True)
            if set(request.data) != {"username"}:
                raise serializers.ValidationError("Only username can be changed here.")
            username = serializer.validated_data["username"]
            with email_lock("username:" + username):
                try:
                    serializer.validate_username(username)
                except serializers.ValidationError as error:
                    raise serializers.ValidationError({"username": error.detail})
                old_username = user.username
                user.username = username
                user.save(update_fields=["username"])
                membership = WorkspaceMembership.objects.select_for_update().filter(user=user).first()
                if membership:
                    workspace = Workspace.objects.select_for_update().get(pk=membership.workspace_id)
                    if workspace.name == f"{old_username}'s workspace" and workspace.memberships.count() == 1:
                        workspace.name = f"{username}'s workspace"
                        workspace.save(update_fields=["name", "updated_at"])
        return Response({"user": user_data(user)})


class ReportingCurrencyView(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def patch(self, request):
        if not isinstance(request.data, dict) or set(request.data) != {"reporting_currency"}:
            raise ValidationError({"reporting_currency": "Only reporting_currency can be changed here."})
        currency = request.data["reporting_currency"]
        if currency not in (*ECB_CURRENCIES, "EUR"):
            raise ValidationError({"reporting_currency": "Choose a supported reporting currency."})
        membership = WorkspaceMembership.objects.get(user=request.user)
        membership.reporting_currency = currency
        membership.save(update_fields=["reporting_currency"])
        return Response({"reporting_currency": currency})


class ReauthenticateView(SecurityView):
    def post(self, request):
        password = request.data.get("password") if isinstance(request.data, dict) else None
        if not isinstance(password, str) or len(password) > 4096 or not request.user.check_password(password):
            raise PermissionDenied("Unable to confirm your password.")
        request.session["auth_time"] = time.time()
        request.session["reauth_user"] = str(request.user.pk)
        return Response({"message": "Identity confirmed."})


class PasswordView(SecurityView):
    def post(self, request):
        serializer = NewPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            if user.has_usable_password():
                current = request.data.get("current_password")
                if not isinstance(current, str) or len(current) > 4096 or not user.check_password(current):
                    raise serializers.ValidationError({"current_password": ["Enter your current password."]})
            elif not recent_auth(request):
                raise PermissionDenied("Sign in again before setting a password.")
            check_password(fields["password"], user)
            user.set_password(fields["password"])
            user.save(update_fields=["password"])
        update_session_auth_hash(request, user)
        return Response({"message": "Password updated."})


def configured_provider(provider):
    return bool(settings.SOCIALACCOUNT_PROVIDERS.get(provider, {}).get("APPS"))


@api_view(["GET"])
@permission_classes([AllowAny])
def providers(request):
    return Response({"providers": [{"id": name, "name": label, "configured": configured_provider(name)}
                                  for name, label in [("google", "Google"), ("github", "GitHub"), ("microsoft", "Microsoft")]]})


@api_view(["GET"])
def methods(request):
    return Response({"password": request.user.has_usable_password(), "recent_auth": recent_auth(request),
                     "providers": list(SocialAccount.objects.filter(user=request.user).values_list("provider", flat=True))})


class DisconnectView(SecurityView):
    def delete(self, request, provider):
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity before disconnecting a sign-in method.")
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            accounts = SocialAccount.objects.filter(user=user)
            account = accounts.filter(provider=provider).first()
            if not account:
                raise NotFound()
            if not user.has_usable_password() and accounts.count() <= 1:
                raise serializers.ValidationError({"provider": ["Add another sign-in method before disconnecting this one."]})
            account.delete()
        return Response(status=204)
