from unittest.mock import patch

import pytest
from django.db import OperationalError


@pytest.mark.django_db
def test_health_checks_database(api):
    response = api.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_handles_database_failure(api):
    with patch("common.health.connection.cursor", side_effect=OperationalError("private database details")):
        response = api.get("/api/v1/health")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unavailable"}
