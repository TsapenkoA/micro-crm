from django.urls import path

from apps.accounts import views
from apps.accounts.oauth import OAuthStartView, PROVIDERS, callback
from apps.clients.views import ClientDetail, ClientLinks, ClientList, ClientNoteDetail, ClientNotes
from apps.deals.views import DealDetail, DealList, DealStatus
from common.health import health

handler500 = "common.errors.server_error"

urlpatterns = [
    path("api/v1/health", health),
    path("api/v1/auth/csrf", views.csrf),
    path("api/v1/auth/login", views.login),
    path("api/v1/auth/logout", views.logout),
    path("api/v1/auth/me", views.me),
    path("api/v1/workspace/counts", views.workspace_counts),
    path("api/v1/workspace/preview", views.preview_dataset),
    path("api/v1/auth/profile", views.ProfileView.as_view()),
    path("api/v1/auth/sign-up", views.SignupView.as_view()),
    path("api/v1/auth/forgot-password", views.ForgotPasswordView.as_view()),
    path("api/v1/auth/reset-password", views.ResetPasswordView.as_view()),
    path("api/v1/auth/password", views.PasswordView.as_view()),
    path("api/v1/auth/reauthenticate", views.ReauthenticateView.as_view()),
    path("api/v1/auth/providers", views.providers),
    path("api/v1/auth/methods", views.methods),
    path("api/v1/auth/providers/<str:provider>", views.DisconnectView.as_view()),
    path("api/v1/auth/oauth/<str:provider>/start", OAuthStartView.as_view()),
    path("api/v1/clients", ClientList.as_view()),
    path("api/v1/clients/<uuid:pk>", ClientDetail.as_view()),
    path("api/v1/clients/<uuid:pk>/notes", ClientNotes.as_view()),
    path("api/v1/clients/<uuid:pk>/notes/<uuid:note_id>", ClientNoteDetail.as_view()),
    path("api/v1/clients/<uuid:pk>/links", ClientLinks.as_view()),
    path("api/v1/deals", DealList.as_view()),
    path("api/v1/deals/<uuid:pk>", DealDetail.as_view()),
    path("api/v1/deals/<uuid:pk>/status", DealStatus.as_view()),
]

for provider in PROVIDERS:
    urlpatterns.append(path(f"api/v1/auth/oauth/{provider}/callback/", callback, {"provider": provider}, name=f"{provider}_callback"))
