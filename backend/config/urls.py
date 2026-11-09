from django.urls import path

from crm.api import views
from crm.auth.oauth import OAuthStartView, PROVIDERS, callback

handler500 = "crm.api.errors.server_error"

urlpatterns = [
    path("api/v1/health", views.health),
    path("api/v1/auth/csrf", views.csrf),
    path("api/v1/auth/login", views.login),
    path("api/v1/auth/logout", views.logout),
    path("api/v1/auth/me", views.me),
    path("api/v1/workspace/counts", views.workspace_counts),
    path("api/v1/workspace/preview", views.preview_dataset),
    path("api/v1/auth/profile", views.ProfileView.as_view()),
    path("api/v1/auth/reporting-currency", views.ReportingCurrencyView.as_view()),
    path("api/v1/auth/sign-up", views.SignupView.as_view()),
    path("api/v1/auth/forgot-password", views.ForgotPasswordView.as_view()),
    path("api/v1/auth/reset-password", views.ResetPasswordView.as_view()),
    path("api/v1/auth/password", views.PasswordView.as_view()),
    path("api/v1/auth/reauthenticate", views.ReauthenticateView.as_view()),
    path("api/v1/auth/providers", views.providers),
    path("api/v1/auth/methods", views.methods),
    path("api/v1/auth/providers/<str:provider>", views.DisconnectView.as_view()),
    path("api/v1/auth/oauth/<str:provider>/start", OAuthStartView.as_view()),
    path("api/v1/clients", views.ClientList.as_view()),
    path("api/v1/clients/<uuid:pk>", views.ClientDetail.as_view()),
    path("api/v1/clients/<uuid:pk>/notes", views.ClientNotes.as_view()),
    path("api/v1/clients/<uuid:pk>/notes/<uuid:note_id>", views.ClientNoteDetail.as_view()),
    path("api/v1/clients/<uuid:pk>/links", views.ClientLinks.as_view()),
    path("api/v1/deals", views.DealList.as_view()),
    path("api/v1/deals/<uuid:pk>", views.DealDetail.as_view()),
    path("api/v1/deals/<uuid:pk>/status", views.DealStatus.as_view()),
    path("api/v1/invoices", views.InvoiceList.as_view()),
    path("api/v1/invoices/<uuid:pk>", views.InvoiceDetail.as_view()),
    path("api/v1/invoices/<uuid:pk>/status", views.InvoiceStatus.as_view()),
    path("api/v1/invoices/<uuid:pk>/pdf", views.InvoicePDF.as_view()),
    path("api/v1/analytics/dashboard", views.Dashboard.as_view()),
]

for provider in PROVIDERS:
    urlpatterns.append(path(f"api/v1/auth/oauth/{provider}/callback/", callback, {"provider": provider}, name=f"{provider}_callback"))
