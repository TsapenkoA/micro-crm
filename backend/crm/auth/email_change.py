import hashlib
from datetime import timedelta

from allauth.account.models import EmailAddress
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from crm.auth.security import email_in_use, email_lock, recent_auth
from crm.auth.serializers import EmailSerializer, VerifyEmailSerializer
from crm.auth.verification import VerificationEmailUnavailable, new_token
from crm.auth.views import SecurityView, user_data
from crm.models import PendingEmailChange


INVALID_TOKEN = "This link is invalid or has expired. Request another email change."


class RequestEmailChange(SecurityView):
    def post(self, request):
        if not recent_auth(request):
            raise PermissionDenied("Confirm your identity in Security before changing your email.")
        serializer = EmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().casefold()
        if email == request.user.email.casefold():
            raise serializers.ValidationError({"email": "Enter a different email address."})
        with email_lock(email):
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            PendingEmailChange.objects.filter(email=email, expires_at__lte=timezone.now()).delete()
            if email_in_use(email) or PendingEmailChange.objects.filter(email=email).exclude(user=request.user).exists():
                raise serializers.ValidationError({"email": "This email address is unavailable."})
            token, digest = new_token()
            PendingEmailChange.objects.update_or_create(
                user=request.user,
                defaults={"email": email, "token_hash": digest, "expires_at": timezone.now() + timedelta(hours=24)},
            )
            link = f"{settings.FRONTEND_URL}/#/settings?email_change_token={token}"
            body = f"Confirm your new MicroFlow email address using this link:\n\n{link}\n\nThis link expires in 24 hours. If you did not request this change, ignore this email."
            try:
                sent = send_mail("Confirm your new MicroFlow email address", body, settings.DEFAULT_FROM_EMAIL, [email])
            except Exception as exc:
                raise VerificationEmailUnavailable() from exc
            if sent != 1:
                raise VerificationEmailUnavailable()
        return Response({"message": "Check the new email address for a confirmation link."}, status=202)


class ConfirmEmailChange(SecurityView):
    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        digest = hashlib.sha256(serializer.validated_data["token"].encode()).hexdigest()
        candidate = PendingEmailChange.objects.filter(user=request.user, token_hash=digest).values_list("email", flat=True).first()
        if not candidate:
            raise serializers.ValidationError({"token": INVALID_TOKEN})
        with email_lock(candidate):
            with transaction.atomic():
                pending = PendingEmailChange.objects.select_for_update().filter(user=request.user, token_hash=digest).first()
                if not pending or pending.expires_at <= timezone.now() or email_in_use(candidate):
                    raise serializers.ValidationError({"token": INVALID_TOKEN})
                user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
                user.email = candidate
                user.save(update_fields=["email"])
                EmailAddress.objects.filter(user=user).delete()
                EmailAddress.objects.create(user=user, email=candidate, verified=True, primary=True)
                pending.delete()
        return Response({"user": user_data(user)})
