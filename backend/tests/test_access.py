from types import SimpleNamespace

import pytest
from django.http import Http404
from rest_framework import generics, serializers
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.clients.models import Client
from common.permissions import IsOwner, OwnerQuerysetMixin, owned_object_or_404

pytestmark = pytest.mark.django_db


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = ["id", "name"]


class ClientDetail(OwnerQuerysetMixin, generics.RetrieveAPIView):
    queryset = Client.objects.all()
    serializer_class = ClientSerializer


def test_owner_scoped_lookup_hides_foreign_record(user, other_user, client_record):
    assert owned_object_or_404(Client.objects.all(), user, pk=client_record.pk) == client_record
    with pytest.raises(Http404):
        owned_object_or_404(Client.objects.all(), other_user, pk=client_record.pk)
    permission = IsOwner()
    assert permission.has_object_permission(SimpleNamespace(user=user), None, client_record)
    assert not permission.has_object_permission(SimpleNamespace(user=other_user), None, client_record)


def test_owner_scoped_api_returns_404_for_other_account(user, other_user, client_record):
    factory = APIRequestFactory()
    view = ClientDetail.as_view()
    for actor, status in [(user, 200), (other_user, 404), (None, 403)]:
        request = factory.get("/test-only/clients")
        if actor:
            force_authenticate(request, user=actor)
        response = view(request, pk=client_record.pk)
        assert response.status_code == status
