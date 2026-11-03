from django.urls import path

from apps.accounts import views
from apps.clients.views import ClientDetail, ClientLinks, ClientList, ClientNoteDetail, ClientNotes
from common.health import health

handler500 = "common.errors.server_error"

urlpatterns = [
    path("api/v1/health", health),
    path("api/v1/auth/csrf", views.csrf),
    path("api/v1/auth/login", views.login),
    path("api/v1/auth/logout", views.logout),
    path("api/v1/auth/me", views.me),
    path("api/v1/clients", ClientList.as_view()),
    path("api/v1/clients/<uuid:pk>", ClientDetail.as_view()),
    path("api/v1/clients/<uuid:pk>/notes", ClientNotes.as_view()),
    path("api/v1/clients/<uuid:pk>/notes/<uuid:note_id>", ClientNoteDetail.as_view()),
    path("api/v1/clients/<uuid:pk>/links", ClientLinks.as_view()),
]
