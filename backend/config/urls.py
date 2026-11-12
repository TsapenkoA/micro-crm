from django.urls import path

from crm.api.health import health
from crm.auth import views as auth_views
from crm.auth import verification as verification_views
from crm.auth.avatar import AvatarView
from crm.workspaces import views as workspace_views
from crm.workspaces.operations import operations_status
from crm.clients import views as client_views
from crm.deals import views as deal_views
from crm.invoices import views as invoice_views
from crm.analytics import views as analytics_views
from crm.auth.oauth import OAuthStartView, PROVIDERS, callback

handler500 = "crm.api.errors.server_error"

urlpatterns = [
    path("api/v1/health", health),
    path("api/v1/auth/csrf", auth_views.csrf),
    path("api/v1/auth/login", auth_views.login),
    path("api/v1/auth/logout", auth_views.logout),
    path("api/v1/auth/me", auth_views.me),
    path("api/v1/workspace/counts", workspace_views.workspace_counts),
    path("api/v1/workspace/operations", operations_status),
    path("api/v1/workspace/settings", workspace_views.WorkspaceSettings.as_view()),
    path("api/v1/workspace/members", workspace_views.WorkspaceMembers.as_view()),
    path("api/v1/workspace/members/<int:user_id>", workspace_views.WorkspaceMemberDetail.as_view()),
    path("api/v1/workspace/bank-details", workspace_views.WorkspaceBankDetails.as_view()),
    path("api/v1/workspace/seller-details", workspace_views.WorkspaceSellerDetails.as_view()),
    path("api/v1/workspace/preview", workspace_views.preview_dataset),
    path("api/v1/auth/profile", auth_views.ProfileView.as_view()),
    path("api/v1/auth/avatar", AvatarView.as_view()),
    path("api/v1/auth/reporting-currency", auth_views.ReportingCurrencyView.as_view()),
    path("api/v1/auth/sign-up", verification_views.SignupView.as_view()),
    path("api/v1/auth/resend-verification", verification_views.ResendVerificationView.as_view()),
    path("api/v1/auth/verify-email", verification_views.VerifyEmailView.as_view()),
    path("api/v1/auth/forgot-password", auth_views.ForgotPasswordView.as_view()),
    path("api/v1/auth/reset-password", auth_views.ResetPasswordView.as_view()),
    path("api/v1/auth/password", auth_views.PasswordView.as_view()),
    path("api/v1/auth/reauthenticate", auth_views.ReauthenticateView.as_view()),
    path("api/v1/auth/providers", auth_views.providers),
    path("api/v1/auth/methods", auth_views.methods),
    path("api/v1/auth/providers/<str:provider>", auth_views.DisconnectView.as_view()),
    path("api/v1/auth/oauth/<str:provider>/start", OAuthStartView.as_view()),
    path("api/v1/clients", client_views.ClientList.as_view()),
    path("api/v1/clients/<uuid:pk>", client_views.ClientDetail.as_view()),
    path("api/v1/clients/<uuid:pk>/notes", client_views.ClientNotes.as_view()),
    path("api/v1/clients/<uuid:pk>/notes/<uuid:note_id>", client_views.ClientNoteDetail.as_view()),
    path("api/v1/clients/<uuid:pk>/links", client_views.ClientLinks.as_view()),
    path("api/v1/deals", deal_views.DealList.as_view()),
    path("api/v1/deals/<uuid:pk>", deal_views.DealDetail.as_view()),
    path("api/v1/deals/<uuid:pk>/status", deal_views.DealStatus.as_view()),
    path("api/v1/invoices", invoice_views.InvoiceList.as_view()),
    path("api/v1/invoices/<uuid:pk>", invoice_views.InvoiceDetail.as_view()),
    path("api/v1/invoices/<uuid:pk>/status", invoice_views.InvoiceStatus.as_view()),
    path("api/v1/invoices/<uuid:pk>/payments", invoice_views.InvoicePayments.as_view()),
    path("api/v1/invoices/<uuid:pk>/cancel", invoice_views.InvoiceCancel.as_view()),
    path("api/v1/invoices/<uuid:pk>/send", invoice_views.InvoiceSend.as_view()),
    path("api/v1/invoices/<uuid:pk>/reminder", invoice_views.InvoiceReminder.as_view()),
    path("api/v1/invoices/<uuid:pk>/pdf", invoice_views.InvoicePDF.as_view()),
    path("api/v1/analytics/dashboard", analytics_views.Dashboard.as_view()),
]

for provider in PROVIDERS:
    urlpatterns.append(path(f"api/v1/auth/oauth/{provider}/callback/", callback, {"provider": provider}, name=f"{provider}_callback"))
