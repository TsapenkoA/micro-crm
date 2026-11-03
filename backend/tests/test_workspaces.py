from io import StringIO

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction

from apps.accounts.models import Workspace, WorkspaceMembership
from apps.clients.models import ClientNote
from apps.deals.models import Deal
from apps.invoices.models import Invoice

pytestmark = pytest.mark.django_db


def test_new_users_receive_distinct_workspaces(user, other_user):
    assert user.workspace_membership.workspace_id != other_user.workspace_membership.workspace_id
    assert WorkspaceMembership.objects.filter(user=user).count() == 1


def test_database_enforces_one_workspace_per_user(user):
    workspace = Workspace.objects.create(name="Another company")
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkspaceMembership.objects.bulk_create([WorkspaceMembership(user=user, workspace=workspace)])


def test_command_assigns_employee_without_changing_other_members(user, other_user):
    target = user.workspace_membership.workspace_id
    original = other_user.workspace_membership.workspace_id
    call_command("assign_workspace", other_user.username, str(target), stdout=StringIO())
    call_command("assign_workspace", other_user.username, str(target), stdout=StringIO())
    assert WorkspaceMembership.objects.get(user=other_user).workspace_id == target
    assert WorkspaceMembership.objects.get(user=user).workspace_id == target
    assert Workspace.objects.filter(pk=original).exists()
    assert WorkspaceMembership.objects.filter(user=other_user).count() == 1


def test_command_repairs_explicitly_unassigned_user(user, other_user):
    WorkspaceMembership.objects.filter(user=other_user).delete()
    call_command("assign_workspace", other_user.username, str(user.workspace_membership.workspace_id), stdout=StringIO())
    assert WorkspaceMembership.objects.get(user=other_user).workspace_id == user.workspace_membership.workspace_id


def test_command_rejects_move_from_workspace_with_data(user, other_user, client_record):
    original = WorkspaceMembership.objects.get(user=user).workspace_id
    with pytest.raises(CommandError):
        call_command("assign_workspace", user.username, str(other_user.workspace_membership.workspace_id), stdout=StringIO())
    assert WorkspaceMembership.objects.get(user=user).workspace_id == original
    client_record.refresh_from_db()
    assert client_record.workspace_id == original


@pytest.mark.parametrize("target", ["invalid-uuid", "00000000-0000-0000-0000-000000000001"])
def test_command_reports_invalid_workspace(user, target):
    with pytest.raises(CommandError):
        call_command("assign_workspace", user.username, target, stdout=StringIO())


def test_colleagues_can_author_related_records(user, other_user, client_record):
    call_command("assign_workspace", other_user.username, str(client_record.workspace_id), stdout=StringIO())
    note = ClientNote.objects.create(client=client_record, author=other_user, text="Colleague note")
    deal = Deal.objects.create(workspace=client_record.workspace, created_by=other_user, client=client_record, title="Team deal", amount=10, currency="EUR")
    invoice = Invoice.objects.create(workspace=client_record.workspace, created_by=other_user, client=client_record, invoice_number="SHARED-1", currency="EUR")
    assert note.author == other_user
    assert deal.workspace_id == invoice.workspace_id == client_record.workspace_id
    with pytest.raises(ValidationError):
        Invoice.objects.create(workspace=client_record.workspace, created_by=user, client=client_record, invoice_number="SHARED-1", currency="EUR")


def test_workspace_and_creator_cannot_be_changed(user, other_user, client_record):
    client_record.workspace = other_user.workspace_membership.workspace
    client_record.created_by = other_user
    with pytest.raises(ValidationError):
        client_record.save()


def test_command_rejects_unknown_user(user):
    with pytest.raises(CommandError):
        call_command("assign_workspace", "missing-user", str(user.workspace_membership.workspace_id), stdout=StringIO())
