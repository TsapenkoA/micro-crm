import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_workspace_scoped_lookup_hides_foreign_record(user, other_user, client_record):
    api = APIClient()
    for actor, status in [(user, 200), (other_user, 404), (None, 403)]:
        api.force_authenticate(user=actor)
        response = api.get(f"/api/v1/clients/{client_record.pk}")
        assert response.status_code == status


def test_workspace_scoped_list_hides_foreign_records(user, other_user, client_record):
    api = APIClient()
    api.force_authenticate(user=other_user)
    response = api.get("/api/v1/clients")
    assert response.status_code == 200
    assert response.json() == {"count": 0, "next": None, "previous": None, "results": []}
