from django.http import JsonResponse
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None:
        response.data = {"error": {"code": response.status_code, "details": response.data}}
    return response


def csrf_failure(request, reason=""):
    return JsonResponse({"error": {"code": 403, "details": "CSRF verification failed."}}, status=403)


def server_error(request):
    return JsonResponse({"error": {"code": 500, "details": "Internal server error."}}, status=500)
