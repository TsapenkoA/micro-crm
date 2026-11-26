from django.conf import settings
from django.utils import timezone
from django.utils.cache import patch_vary_headers


class WorkspaceTimezoneMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        zone = settings.TIME_ZONE
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            from crm.models import WorkspaceMembership

            zone = WorkspaceMembership.objects.filter(user_id=user.pk).values_list("workspace__time_zone", flat=True).first() or zone
        with timezone.override(zone):
            return self.get_response(request)


class PrivateResponseMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            response["Cache-Control"] = "private, no-store, max-age=0"
            response["Pragma"] = "no-cache"
            patch_vary_headers(response, ["Cookie"])
        response["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
        response["Referrer-Policy"] = "no-referrer"
        response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response
