from django.http import JsonResponse
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError
from rest_framework.serializers import as_serializer_error
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = ValidationError(as_serializer_error(exc))
    response = drf_exception_handler(exc, context)
    if response is not None:
        reason = getattr(exc, "default_code", "error")
        response.data = {"error": {"code": response.status_code, "reason": reason, "details": response.data}}
    return response


def csrf_failure(request, reason=""):
    return JsonResponse({"error": {"code": 403, "details": "CSRF verification failed."}}, status=403)


def server_error(request):
    return JsonResponse({"error": {"code": 500, "details": "Internal server error."}}, status=500)
