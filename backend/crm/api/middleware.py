from django.utils.cache import patch_vary_headers


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
