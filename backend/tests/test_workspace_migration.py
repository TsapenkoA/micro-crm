import uuid
from decimal import Decimal

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


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
    invoice = apps.get_model("invoices", "Invoice").objects.create(owner_id=admin.pk, client=client, invoice_number="LEGACY-001", currency="EUR", buyer_snapshot={"name": "Legacy Acme"}, seller_snapshot={"name": "Seller"}, subtotal=Decimal("10.00"), tax_total=Decimal("2.00"), total_amount=Decimal("12.00"))
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
        assert actual == expected
    Membership = migrated.get_model("accounts", "WorkspaceMembership")
    workspace_id = Membership.objects.get(user_id=admin.pk).workspace_id
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
