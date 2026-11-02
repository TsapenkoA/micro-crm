from django.contrib.auth import authenticate, login as session_login, logout as session_logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


def user_data(user):
    return {"id": user.pk, "username": user.username, "email": user.email}


@api_view(["GET"])
@permission_classes([AllowAny])
def csrf(request):
    return Response({"csrfToken": get_token(request)})


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(request, **serializer.validated_data)
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
