from django.urls import path

from apps.accounts import views
from common.health import health

handler500 = "common.errors.server_error"

urlpatterns = [
    path("api/v1/health", health),
    path("api/v1/auth/csrf", views.csrf),
    path("api/v1/auth/login", views.login),
    path("api/v1/auth/logout", views.logout),
    path("api/v1/auth/me", views.me),
]
