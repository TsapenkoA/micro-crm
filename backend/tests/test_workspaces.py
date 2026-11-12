import uuid
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, OperationalError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

import pytest
from rest_framework.test import APIClient

from crm.models import BackupCheck, Client, ClientNote, Deal, FxRate, FxSyncRun, Invoice, PreviewDataset, Workspace, WorkspaceMembership

pytestmark = pytest.mark.django_db


def test_database_enforces_one_workspace_per_user(user):
    workspace = Workspace.objects.create(name="Another company")
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkspaceMembership.objects.bulk_create([WorkspaceMembership(user=user, workspace=workspace)])


def test_operations_status_is_visible_only_to_workspace_owner(api, user, other_user, settings, tmp_path):
    url = "/api/v1/workspace/operations"
    settings.BACKUP_DIRECTORY = ""
    assert api.get(url).status_code == 403
    api.force_login(user)
    initial = api.get(url)
    assert initial.status_code == 200
    assert initial.json()["exchange_rates"]["healthy"] is False
    assert initial.json()["backup"]["last_restore_verified_at"] is None
    assert initial.json()["backup"]["last_stored_archive_at"] is None
    assert initial["Cache-Control"] == "no-store"

    today = timezone.localdate()
    from crm.services.fx import ECB_CURRENCIES
    for currency in ECB_CURRENCIES:
        FxRate.objects.create(date=today, currency=currency, per_eur=Decimal("1.20"))
    FxSyncRun.objects.create(status="success", finished_at=timezone.now(), latest_rate_date=today)
    BackupCheck.objects.create(archive_bytes=100)
    archive = tmp_path / "microflow-test.dump"
    archive.write_bytes(b"test archive")
    settings.BACKUP_DIRECTORY = str(tmp_path)
    data = api.get(url).json()
    assert data["exchange_rates"]["healthy"] is True
    assert data["exchange_rates"]["latest_complete_date"] == today.isoformat()
    assert data["backup"]["last_restore_verified_at"] is not None
    assert data["backup"]["last_stored_archive_at"] is not None
    assert str(tmp_path) not in str(data)

    WorkspaceMembership.objects.filter(user=other_user).update(workspace=user.workspace_membership.workspace)
    api.force_login(other_user)
    assert api.get(url).status_code == 403


def test_command_assigns_employee_without_changing_other_members(user, other_user):
    target = user.workspace_membership.workspace_id
    original = other_user.workspace_membership.workspace_id
    call_command("assign_workspace", other_user.username, str(target), stdout=StringIO())
    call_command("assign_workspace", other_user.username, str(target), stdout=StringIO())
    assert WorkspaceMembership.objects.get(user=other_user).workspace_id == target
    assert WorkspaceMembership.objects.get(user=user).workspace_id == target
    assert Workspace.objects.filter(pk=original).exists()
    assert WorkspaceMembership.objects.filter(user=other_user).count() == 1


def test_command_rejects_move_from_workspace_with_data(user, other_user, client_record):
    original = WorkspaceMembership.objects.get(user=user).workspace_id
    with pytest.raises(CommandError):
        call_command("assign_workspace", user.username, str(other_user.workspace_membership.workspace_id), stdout=StringIO())
    assert WorkspaceMembership.objects.get(user=user).workspace_id == original
    client_record.refresh_from_db()
    assert client_record.workspace_id == original


def test_workspace_and_creator_cannot_be_changed(user, other_user, client_record):
    client_record.workspace = other_user.workspace_membership.workspace
    client_record.created_by = other_user
    with pytest.raises(ValidationError):
        client_record.save()


def make_deal(user, client, **fields):
    return Deal.objects.create(workspace=user.workspace_membership.workspace, created_by=user, client=client, title="Design", amount=Decimal("1500.25"), currency="USD", **fields)


def make_invoice(user, client, **fields):
    return Invoice.objects.create(workspace=user.workspace_membership.workspace, created_by=user, client=client, invoice_number="INV-001", currency="EUR", **fields)


@pytest.mark.parametrize("model", ["deal", "invoice", "note"])
def test_cross_workspace_relations_rejected(model, user, other_user, client_record):
    with pytest.raises(ValidationError):
        if model == "deal":
            make_deal(other_user, client_record)
        elif model == "invoice":
            make_invoice(other_user, client_record)
        else:
            ClientNote.objects.create(client=client_record, author=other_user, text="Forbidden")


def test_database_rejects_negative_amount_on_bulk_update(user, client_record):
    deal = make_deal(user, client_record)
    with pytest.raises(IntegrityError), transaction.atomic():
        Deal.objects.filter(pk=deal.pk).update(amount=-1)


def test_invoice_number_unique_per_workspace(user, other_user, client_record):
    from crm.models import Client

    make_invoice(user, client_record)
    with pytest.raises(ValidationError):
        make_invoice(user, client_record)
    other_client = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Other")
    assert make_invoice(other_user, other_client).invoice_number == "INV-001"


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


def test_workspace_settings_rename_is_shared_and_isolated(api, user, other_user):
    path = "/api/v1/workspace/settings"
    workspace = user.workspace_membership.workspace
    foreign = other_user.workspace_membership.workspace
    assert api.get(path).status_code == 403

    api.force_login(user)
    assert api.get(path).json()["members"] == [{"id": user.pk, "username": user.username, "name": "", "email": user.email}]
    assert api.patch(path, {"name": "New name"}, format="json").status_code == 403
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert api.patch(path, {"name": "  Northstar Studio  "}, format="json", HTTP_X_CSRFTOKEN=token).json()["name"] == "Northstar Studio"
    for payload in ({"name": " "}, {"name": "x" * 201}, {"name": "Valid", "workspace_id": str(foreign.pk)}):
        assert api.patch(path, payload, format="json", HTTP_X_CSRFTOKEN=token).status_code == 400
    workspace.refresh_from_db()
    assert workspace.name == "Northstar Studio"
    foreign.refresh_from_db()
    assert foreign.name != workspace.name

    colleague = other_user
    call_command("assign_workspace", colleague.username, str(workspace.pk), stdout=StringIO())
    same = APIClient()
    same.force_login(colleague)
    assert same.get(path).json()["name"] == "Northstar Studio"
    assert {member["username"] for member in same.get(path).json()["members"]} == {user.username, colleague.username}


def test_only_owner_can_add_an_existing_account_with_an_empty_personal_workspace(api, user, other_user):
    path = "/api/v1/workspace/members"
    target = user.workspace_membership.workspace
    source = other_user.workspace_membership.workspace
    assert target.owner_id == user.pk
    assert source.owner_id == other_user.pk
    assert api.post(path, {"username": other_user.username}, format="json").status_code == 403

    csrf = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    login = api.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json", HTTP_X_CSRFTOKEN=csrf)
    assert login.status_code == 200
    token = login.json()["csrfToken"]
    assert api.post(path, {"username": other_user.username}, format="json").status_code == 403
    assert api.post(path, {"username": "unknown"}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 409
    assert api.post(path, {"username": other_user.username, "workspace_id": str(target.pk)}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 400
    response = api.post(path, {"username": other_user.username}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 201
    assert response.json()["member"] == {"id": other_user.pk, "username": other_user.username, "name": "", "email": other_user.email}
    assert WorkspaceMembership.objects.get(user=other_user).workspace_id == target.pk
    source.refresh_from_db()
    assert source.owner_id is None

    colleague = APIClient(enforce_csrf_checks=True)
    colleague_csrf = colleague.get("/api/v1/auth/csrf").json()["csrfToken"]
    colleague_token = colleague.post("/api/v1/auth/login", {"username": other_user.username, "password": "other-password-123"}, format="json", HTTP_X_CSRFTOKEN=colleague_csrf).json()["csrfToken"]
    assert colleague.get("/api/v1/workspace/settings").json()["can_manage_members"] is False
    assert colleague.post(path, {"username": user.username}, format="json", HTTP_X_CSRFTOKEN=colleague_token).status_code == 403


def test_member_with_business_records_cannot_be_moved(api, user, other_user):
    Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Existing work")
    csrf = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    token = api.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json", HTTP_X_CSRFTOKEN=csrf).json()["csrfToken"]
    response = api.post("/api/v1/workspace/members", {"username": other_user.username}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 409
    assert WorkspaceMembership.objects.get(user=other_user).workspace_id == other_user.workspace_membership.workspace_id


def test_owner_removes_member_without_moving_company_records(user, other_user):
    company = user.workspace_membership.workspace
    call_command("assign_workspace", other_user.username, str(company.pk), stdout=StringIO())
    other_user.refresh_from_db()
    client = Client.objects.create(workspace=company, created_by=other_user, name="Shared client")
    deal = make_deal(other_user, client)
    invoice = make_invoice(other_user, client)
    note = ClientNote.objects.create(client=client, author=other_user, text="Shared history")

    employee = APIClient(enforce_csrf_checks=True)
    employee_csrf = employee.get("/api/v1/auth/csrf").json()["csrfToken"]
    employee.post("/api/v1/auth/login", {"username": other_user.username, "password": "other-password-123"}, format="json", HTTP_X_CSRFTOKEN=employee_csrf)
    assert employee.get("/api/v1/clients").json()["count"] == 1

    owner = APIClient(enforce_csrf_checks=True)
    owner_csrf = owner.get("/api/v1/auth/csrf").json()["csrfToken"]
    token = owner.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json", HTTP_X_CSRFTOKEN=owner_csrf).json()["csrfToken"]
    url = f"/api/v1/workspace/members/{other_user.pk}"
    assert owner.delete("/api/v1/workspace/members", HTTP_X_CSRFTOKEN=token).status_code == 405
    assert owner.delete(url).status_code == 403
    assert owner.delete(url, HTTP_X_CSRFTOKEN=token).status_code == 204
    assert employee.get("/api/v1/clients").status_code == 403

    membership = WorkspaceMembership.objects.get(user=other_user)
    assert membership.workspace_id != company.pk
    assert membership.workspace.owner_id == other_user.pk
    assert owner.get("/api/v1/clients").json()["count"] == 1
    assert owner.get(f"/api/v1/clients/{client.pk}").status_code == 200
    assert owner.get(f"/api/v1/deals/{deal.pk}").status_code == 200
    assert owner.get(f"/api/v1/invoices/{invoice.pk}").status_code == 200
    assert owner.get(f"/api/v1/clients/{client.pk}/notes").json()["results"][0]["id"] == str(note.pk)
    client.name = "Updated by company"
    client.save()
    invoice.payment_terms = "Net 30"
    invoice.save()

    new_csrf = employee.get("/api/v1/auth/csrf").json()["csrfToken"]
    employee.post("/api/v1/auth/login", {"username": other_user.username, "password": "other-password-123"}, format="json", HTTP_X_CSRFTOKEN=new_csrf)
    assert employee.get("/api/v1/clients").json()["count"] == 0
    assert employee.get(f"/api/v1/clients/{client.pk}").status_code == 404
    assert employee.get(f"/api/v1/deals/{deal.pk}").status_code == 404
    assert employee.get(f"/api/v1/invoices/{invoice.pk}").status_code == 404
    assert employee.get(f"/api/v1/invoices/{invoice.pk}/pdf").status_code == 404


def test_only_recently_authenticated_owner_can_remove_another_member(user, other_user):
    company = user.workspace_membership.workspace
    call_command("assign_workspace", other_user.username, str(company.pk), stdout=StringIO())
    owner = APIClient(enforce_csrf_checks=True)
    csrf = owner.get("/api/v1/auth/csrf").json()["csrfToken"]
    token = owner.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json", HTTP_X_CSRFTOKEN=csrf).json()["csrfToken"]
    assert owner.delete(f"/api/v1/workspace/members/{user.pk}", HTTP_X_CSRFTOKEN=token).status_code == 403
    assert owner.delete("/api/v1/workspace/members/999999", HTTP_X_CSRFTOKEN=token).status_code == 404
    session = owner.session
    session["auth_time"] = 0
    session.save()
    assert owner.delete(f"/api/v1/workspace/members/{other_user.pk}", HTTP_X_CSRFTOKEN=token).status_code == 403

    colleague = APIClient(enforce_csrf_checks=True)
    colleague_csrf = colleague.get("/api/v1/auth/csrf").json()["csrfToken"]
    colleague_token = colleague.post("/api/v1/auth/login", {"username": other_user.username, "password": "other-password-123"}, format="json", HTTP_X_CSRFTOKEN=colleague_csrf).json()["csrfToken"]
    assert colleague.delete(f"/api/v1/workspace/members/{user.pk}", HTTP_X_CSRFTOKEN=colleague_token).status_code == 403
    assert WorkspaceMembership.objects.get(user=other_user).workspace_id == company.pk


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


@pytest.mark.django_db
def test_health_checks_database(api):
    response = api.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_handles_database_failure(api):
    with patch("crm.api.health.connection.cursor", side_effect=OperationalError("private database details")):
        response = api.get("/api/v1/health")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unavailable"}


@pytest.fixture
def legacy_database(transactional_db):
    schema = "migration_test_" + uuid.uuid4().hex
    quoted = connection.ops.quote_name(schema)
    with connection.cursor() as cursor:
        cursor.execute(f"CREATE SCHEMA {quoted}")
        cursor.execute(f"SET search_path TO {quoted}")
    try:
        executor = MigrationExecutor(connection)
        targets = [("auth", "0012_alter_user_first_name_max_length"), ("clients", "0001_initial"), ("deals", "0001_initial"), ("invoices", "0001_initial")]
        executor.migrate(targets)
        yield executor.loader.project_state(targets).apps
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SET search_path TO public")
            cursor.execute(f"DROP SCHEMA {quoted} CASCADE")


def test_migration_preserves_all_business_records_and_admin(legacy_database):
    apps = legacy_database
    User = apps.get_model("auth", "User")
    admin = User.objects.create(username="admin", password="unchanged-password-hash", is_superuser=True)
    other = User.objects.create(username="other", password="other-hash")
    client = apps.get_model("clients", "Client").objects.create(owner_id=admin.pk, name="Legacy Acme", company="Studio", email="legacy@example.com", phone="123")
    note = apps.get_model("clients", "ClientNote").objects.create(client=client, author_id=admin.pk, text="Keep this note")
    link = apps.get_model("clients", "ClientLink").objects.create(client=client, label="Brief", url="https://example.com")
    deal = apps.get_model("deals", "Deal").objects.create(owner_id=admin.pk, client=client, title="Legacy deal", amount=Decimal("123.45"), currency="EUR")
    invoice = apps.get_model("invoices", "Invoice").objects.create(owner_id=admin.pk, client=client, invoice_number="LEGACY-001", currency="EUR", tax_rate=20, buyer_snapshot={"name": "Legacy Acme"}, seller_snapshot={"name": "Seller"}, subtotal=Decimal("10.00"), tax_total=Decimal("2.00"), total_amount=Decimal("12.00"))
    item = apps.get_model("invoices", "InvoiceItem").objects.create(invoice=invoice, description="Legacy service", quantity=1, unit_price=10, line_total=10)
    records = [admin, other, client, note, link, deal, invoice, item]
    before = {}
    for obj in records:
        values = dict(type(obj).objects.filter(pk=obj.pk).values().get())
        if "owner_id" in values:
            values["created_by_id"] = values.pop("owner_id")
        before[(obj._meta.app_label, obj._meta.model_name, obj.pk)] = values

    executor = MigrationExecutor(connection)
    targets = executor.loader.graph.leaf_nodes()
    executor.migrate(targets)
    migrated = executor.loader.project_state(targets).apps
    for (app, model, pk), expected in before.items():
        actual = migrated.get_model(app, model).objects.filter(pk=pk).values().get()
        actual.pop("workspace_id", None)
        if model == "client":
            assert actual.pop("bank_details") == {}
        if model in ("deal", "invoice"):
            assert actual.pop("fx_rate_date") is None
        if model == "invoice":
            assert actual.pop("deal_id") is None
            assert actual.pop("due_date") is None
            assert actual.pop("payment_terms") == ""
            assert actual.pop("cancelled_at") is None
            assert actual.pop("cancellation_reason") == ""
            assert actual.pop("updated_at") == expected["created_at"]
            assert actual.pop("issued_at") is None
        if model == "invoiceitem":
            assert actual.pop("position") == 0
            assert actual.pop("tax_rate") == Decimal("20.0000")
            assert actual.pop("tax_amount") == Decimal("2.0000")
        assert actual == expected
    Membership = migrated.get_model("accounts", "WorkspaceMembership")
    workspace_id = Membership.objects.get(user_id=admin.pk).workspace_id
    assert migrated.get_model("accounts", "Workspace").objects.get(pk=workspace_id).owner_id == admin.pk
    assert Membership.objects.get(user_id=other.pk).workspace_id != workspace_id
    assert migrated.get_model("clients", "Client").objects.get(pk=client.pk).workspace_id == workspace_id
    assert migrated.get_model("deals", "Deal").objects.get(pk=deal.pk).workspace_id == workspace_id
    assert migrated.get_model("invoices", "Invoice").objects.get(pk=invoice.pk).workspace_id == workspace_id


@pytest.mark.parametrize("relation", ["deal", "invoice", "note"])
def test_migration_rejects_inconsistent_legacy_data_atomically(legacy_database, relation):
    apps = legacy_database
    User = apps.get_model("auth", "User")
    first = User.objects.create(username="first")
    second = User.objects.create(username="second")
    client = apps.get_model("clients", "Client").objects.create(owner_id=first.pk, name="Private client")
    if relation == "deal":
        apps.get_model("deals", "Deal").objects.create(owner_id=second.pk, client=client, title="Invalid legacy link", amount=1, currency="EUR")
    elif relation == "invoice":
        apps.get_model("invoices", "Invoice").objects.create(owner_id=second.pk, client=client, invoice_number="INVALID", currency="EUR")
    else:
        apps.get_model("clients", "ClientNote").objects.create(author_id=second.pk, client=client, text="Invalid legacy author")
    executor = MigrationExecutor(connection)
    with pytest.raises(RuntimeError, match="inconsistent legacy"):
        executor.migrate(executor.loader.graph.leaf_nodes())
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM accounts_workspacemembership")
        assert cursor.fetchone()[0] == 0
        cursor.execute("SELECT name, workspace_id FROM clients_client")
        assert cursor.fetchone() == ("Private client", None)
