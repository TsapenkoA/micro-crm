from datetime import date
from importlib import import_module
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from rest_framework.test import APIClient

from crm.models import Client, ClientAttachment, ClientContact, Invoice

copy_primary_contacts = import_module("crm.migrations.clients.0005_clientattachment_clientcontact").copy_primary_contacts


pytestmark = pytest.mark.django_db


@pytest.fixture
def logged_api(api, user):
    api.force_login(user)
    api.credentials(HTTP_X_CSRFTOKEN=api.get("/api/v1/auth/csrf").json()["csrfToken"])
    return api


def test_client_invoices_are_paginated_and_workspace_scoped(logged_api, user, client_record):
    other = Client.objects.create(workspace=client_record.workspace, created_by=user, name="Other")
    for number, client in enumerate((client_record, other, client_record), 1):
        Invoice.objects.create(workspace=client.workspace, created_by=user, client=client,
                               invoice_number=f"INV-{number}", currency="EUR", total_amount=number * 100,
                               due_date=date(2026, 12, number))
    path = f"/api/v1/clients/{client_record.pk}/invoices"
    first = logged_api.get(path, {"page_size": 1}).json()
    second = logged_api.get(path, {"page_size": 1, "page": 2}).json()
    assert first["count"] == second["count"] == 2
    assert [row["invoice_number"] for row in first["results"] + second["results"]] == ["INV-3", "INV-1"]
    assert first["results"][0]["total_amount"] == "300.00"
    outsider = get_user_model().objects.create_user(username="outsider-invoices")
    foreign_api = APIClient()
    foreign_api.force_authenticate(user=outsider)
    assert foreign_api.get(path).status_code == 404


def test_contact_backfill_and_primary_switch(logged_api, client_record):
    ClientContact.objects.filter(client=client_record).delete()
    copy_primary_contacts(apps, SimpleNamespace(connection=connection))
    path = f"/api/v1/clients/{client_record.pk}/contacts"
    primary = logged_api.get(path).json()[0]
    assert primary["name"] == client_record.name and primary["is_primary"]
    created = logged_api.post(path, {"name": "Morgan Lee", "role": "Billing", "email": "morgan@example.com", "phone": "+49 123"}, format="json")
    assert created.status_code == 201
    updated = logged_api.patch(f"{path}/{created.json()['id']}", {"is_primary": True}, format="json")
    assert updated.status_code == 200
    client_record.refresh_from_db()
    assert (client_record.name, client_record.email, client_record.phone) == ("Morgan Lee", "morgan@example.com", "+49 123")
    assert ClientContact.objects.filter(client=client_record, is_primary=True).count() == 1
    assert logged_api.delete(f"{path}/{created.json()['id']}").status_code == 409


def test_contacts_and_links_cannot_cross_workspaces(logged_api, client_record):
    contact_path = f"/api/v1/clients/{client_record.pk}/contacts"
    link_path = f"/api/v1/clients/{client_record.pk}/links"
    link = logged_api.post(link_path, {"label": "Brief", "url": "https://example.com"}, format="json").json()
    assert logged_api.patch(f"{link_path}/{link['id']}", {"url": "javascript:alert(1)"}, format="json").status_code == 400
    assert logged_api.patch(f"{link_path}/{link['id']}", {"label": "Updated"}, format="json").json()["label"] == "Updated"
    outsider = get_user_model().objects.create_user(username="outsider-links")
    foreign_api = APIClient()
    foreign_api.force_authenticate(user=outsider)
    assert foreign_api.get(contact_path).status_code == 404
    assert foreign_api.post(contact_path, {"name": "Intruder"}, format="json").status_code == 404
    assert foreign_api.patch(f"{link_path}/{link['id']}", {"label": "Intruder"}, format="json").status_code == 404
    assert logged_api.delete(f"{link_path}/{link['id']}").status_code == 204


def test_private_attachment_validates_upload_and_download(logged_api, client_record):
    path = f"/api/v1/clients/{client_record.pk}/attachments"
    file = SimpleUploadedFile("brief.pdf", b"%PDF-1.4\nexample", content_type="application/pdf")
    created = logged_api.post(path, {"file": file}, format="multipart")
    assert created.status_code == 201
    detail = f"{path}/{created.json()['id']}"
    assert logged_api.get(path).json()["results"][0]["name"] == "brief.pdf"
    assert logged_api.get(detail).content == b"%PDF-1.4\nexample"
    outsider = get_user_model().objects.create_user(username="outsider-files")
    foreign_api = APIClient()
    foreign_api.force_authenticate(user=outsider)
    assert foreign_api.get(path).status_code == 404
    assert foreign_api.get(detail).status_code == 404
    assert foreign_api.delete(detail).status_code == 404
    assert logged_api.delete(detail).status_code == 204
    assert not ClientAttachment.objects.exists()


def test_client_delete_removes_files_but_preserves_invoiced_client(logged_api, user, client_record):
    path = f"/api/v1/clients/{client_record.pk}"
    attachment = logged_api.post(
        f"{path}/attachments",
        {"file": SimpleUploadedFile("brief.pdf", b"%PDF-1.4\nexample")},
        format="multipart",
    )
    assert attachment.status_code == 201
    invoice = Invoice.objects.create(
        workspace=client_record.workspace, created_by=user, client=client_record,
        invoice_number="KEEP-1", currency="USD", total_amount=100,
    )
    assert logged_api.delete(path).status_code == 409
    assert ClientAttachment.objects.filter(pk=attachment.json()["id"]).exists()
    invoice.delete()
    assert logged_api.delete(path).status_code == 204
    assert not ClientAttachment.objects.exists()


@pytest.mark.parametrize("name,content", [("bad.pdf", b"not a PDF"), ("script.html", b"<script>bad()</script>"), ("empty.pdf", b"")])
def test_attachment_rejects_invalid_files(logged_api, client_record, name, content):
    file = SimpleUploadedFile(name, content)
    response = logged_api.post(f"/api/v1/clients/{client_record.pk}/attachments", {"file": file}, format="multipart")
    assert response.status_code == 400
    assert not ClientAttachment.objects.exists()
