from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponseRedirect
from allauth.account.adapter import DefaultAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.socialaccount.models import SocialAccount

from .security import email_in_use, email_lock, recent_auth


def oauth_error(reason="failed"):
    raise ImmediateHttpResponse(HttpResponseRedirect(settings.FRONTEND_URL + "/oauth-result?status=" + reason))


class AccountAdapter(DefaultAccountAdapter):
    def get_login_redirect_url(self, request):
        return settings.LOGIN_REDIRECT_URL

    def is_open_for_signup(self, request):
        return False


class SocialAdapter(DefaultSocialAccountAdapter):
    def on_authentication_error(self, request, provider, **kwargs):
        oauth_error()

    def pre_social_login(self, request, sociallogin):
        if sociallogin.state.get("process") == "connect":
            if not recent_auth(request):
                oauth_error("reauthenticate")
            if sociallogin.is_existing and sociallogin.user.pk != request.user.pk:
                oauth_error()
            if SocialAccount.objects.filter(user=request.user, provider=sociallogin.account.provider).exclude(uid=sociallogin.account.uid).exists():
                oauth_error()
        elif sociallogin.is_existing:
            if not sociallogin.user.is_active:
                oauth_error()
        else:
            email = sociallogin.user.email.strip().casefold()
            try:
                validate_email(email)
            except ValidationError:
                oauth_error()
            if len(email) > 254:
                oauth_error()
            if not any(address.verified and address.email.casefold() == email for address in sociallogin.email_addresses):
                oauth_error()
            if email_in_use(email):
                oauth_error("account")

    def is_open_for_signup(self, request, sociallogin):
        return True

    def save_user(self, request, sociallogin, form=None):
        email = sociallogin.user.email.strip().casefold()
        with email_lock(email):
            if email_in_use(email):
                oauth_error("account")
            sociallogin.user.email = email
            return super().save_user(request, sociallogin, form)

    def get_connect_redirect_url(self, request, socialaccount):
        return settings.FRONTEND_URL + "/oauth-result?status=connected"
