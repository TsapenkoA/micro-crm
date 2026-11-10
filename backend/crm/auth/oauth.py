from django.conf import settings
from django.http import HttpResponseRedirect, QueryDict
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.authentication import SessionAuthentication
from allauth.socialaccount.providers.google import views as google
from allauth.socialaccount.providers.github import views as github
from allauth.socialaccount.providers.microsoft import views as microsoft

from .security import recent_auth
from crm.auth.views import PublicAuthView, configured_provider

PROVIDERS = {"google": google, "github": github, "microsoft": microsoft}


@require_GET
def callback(request, provider):
    if not configured_provider(provider):
        return HttpResponseRedirect(settings.FRONTEND_URL + "/oauth-result?status=failed")
    return PROVIDERS[provider].oauth2_callback(request)


@method_decorator(csrf_protect, name="dispatch")
class OAuthStartView(PublicAuthView):
    rate_scope = "oauth"
    authentication_classes = [SessionAuthentication]

    def post(self, request, provider):
        if provider not in PROVIDERS or not configured_provider(provider):
            raise NotFound("This sign-in provider is not configured.")
        if not isinstance(request.data, dict):
            raise ValidationError("Expected a JSON object.")
        process = request.data.get("process", "login")
        if process not in ["login", "connect"]:
            raise ValidationError({"process": ["Choose login or connect."]})
        raw = request._request
        if process == "connect" and not recent_auth(raw):
            raise PermissionDenied("Confirm your identity before connecting a sign-in method.")
        raw.POST = QueryDict(f"process={process}")
        raw.GET = QueryDict()
        response = PROVIDERS[provider].oauth2_login(raw)
        if response.status_code != 302:
            raise ValidationError("Unable to start provider sign-in.")
        return Response({"url": response["Location"]})
