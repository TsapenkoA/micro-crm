import pytest
from rest_framework.test import APIClient

from apps.accounts.models import PreviewDataset
from apps.clients.models import Client
from apps.deals.models import Deal
from apps.invoices.models import Invoice

pytestmark = pytest.mark.django_db


def test_workspace_counts_are_private_and_include_invoices(api, user, other_user):
    workspace = user.workspace_membership.workspace
    client = Client.objects.create(workspace=workspace, created_by=user, name="Own client")
    Deal.objects.create(workspace=workspace, created_by=user, client=client, title="Own deal", amount=100, currency="USD")
    Invoice.objects.create(workspace=workspace, created_by=user, client=client, invoice_number="INV-1", currency="USD")
    Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Other client")

    assert api.get("/api/v1/workspace/counts").status_code == 403
    api.force_login(user)
    assert api.get("/api/v1/workspace/counts").json() == {"clients": 1, "deals": 1, "invoices": 1}

    other = APIClient()
    other.force_login(other_user)
    assert other.get("/api/v1/workspace/counts").json() == {"clients": 1, "deals": 0, "invoices": 0}


def test_preview_dataset_requires_membership_and_stays_with_its_workspace(api, user, other_user):
    own_payload = {"workspaceName": "Own preview", "clients": []}
    foreign_payload = {"workspaceName": "Other preview", "clients": []}
    PreviewDataset.objects.create(workspace=user.workspace_membership.workspace, payload=own_payload)
    PreviewDataset.objects.create(workspace=other_user.workspace_membership.workspace, payload=foreign_payload)

    assert api.get("/api/v1/workspace/preview").status_code == 403
    api.force_login(user)
    response = api.get("/api/v1/workspace/preview")
    assert response.status_code == 200
    assert response.json() == own_payload

    other = APIClient()
    other.force_login(other_user)
    assert other.get("/api/v1/workspace/preview").json() == foreign_payload

    PreviewDataset.objects.filter(workspace=other_user.workspace_membership.workspace).delete()
    assert other.get("/api/v1/workspace/preview").status_code == 404
