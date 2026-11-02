import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.clients.models import Client


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(username="alex", password="test-password-123", email="alex@example.com")


@pytest.fixture
def other_user(db):
    return get_user_model().objects.create_user(username="other", password="other-password-123")


@pytest.fixture
def client_record(user):
    return Client.objects.create(owner=user, name="Acme", email="hello@example.com")


@pytest.fixture
def api():
    return APIClient(enforce_csrf_checks=True)
