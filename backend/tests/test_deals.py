import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.db.models.query import QuerySet
from rest_framework.test import APIClient

from apps.accounts.models import WorkspaceMembership
from apps.clients.models import Client
from apps.deals.models import Deal

pytestmark = pytest.mark.django_db


@pytest.fixture
def authenticated_api(api, user):
    api.force_login(user)
    api.credentials(HTTP_X_CSRFTOKEN=api.get("/api/v1/auth/csrf").json()["csrfToken"])
    return api


@pytest.fixture
def colleague(user):
    employee = get_user_model().objects.create_user(username="colleague", password="colleague-password")
    call_command("assign_workspace", employee.username, str(user.workspace_membership.workspace_id))
    return employee


@pytest.fixture
def deal(user, client_record):
    return Deal.objects.create(workspace=client_record.workspace, created_by=user, client=client_record, title="Website", amount="1234.56", currency="EUR")


def payload(record, **changes):
    return {"title": "Website", "client": str(record.pk), "amount": "1234.56", "currency": "EUR", **changes}


def test_create_detail_and_persistence(authenticated_api, user, client_record):
    response = authenticated_api.post("/api/v1/deals", payload(client_record, deadline="2026-12-01T15:00:00+03:00"), format="json")
    assert response.status_code == 201
    data = response.json()
    assert set(data) == {"id", "title", "client", "status", "amount", "currency", "deadline", "version", "outcome", "paid_at", "created_at", "updated_at"}
    assert data["amount"] == "1234.56"
    assert data["deadline"] == "2026-12-01T12:00:00Z"
    assert data["status"] == "new_lead" and data["outcome"] == "none"
    assert data["version"] == 1 and data["paid_at"] is None
    saved = Deal.objects.get(pk=data["id"])
    assert saved.workspace_id == user.workspace_membership.workspace_id
    assert saved.created_by_id == user.pk
    assert saved.amount == Decimal("1234.56")
    assert authenticated_api.get(f"/api/v1/deals/{saved.pk}").json() == data
    assert authenticated_api.get(f"/api/v1/clients/{client_record.pk}").json()["deals"][0]["id"] == data["id"]


def test_put_patch_delete(authenticated_api, deal, client_record, user):
    path = f"/api/v1/deals/{deal.pk}"
    another = Client.objects.create(workspace=deal.workspace, created_by=user, name="Another client")
    response = authenticated_api.put(path, payload(another, version=1, title="Updated", amount="0.00", deadline=None), format="json")
    assert response.status_code == 200
    assert response.json()["version"] == 2
    assert response.json()["client"] == str(another.pk)
    response = authenticated_api.patch(path, {"title": "Final", "version": 2}, format="json")
    assert response.status_code == 200 and response.json()["version"] == 3
    assert response.json()["amount"] == "0.00"
    assert authenticated_api.delete(path, {"version": 2}, format="json").status_code == 409
    assert authenticated_api.delete(path, {"version": 3}, format="json").status_code == 204
    assert authenticated_api.get(path).status_code == 404
    assert authenticated_api.delete(path, {"version": 3}, format="json").status_code == 404
    assert Client.objects.filter(pk=client_record.pk).exists()
    assert Client.objects.filter(pk=another.pk).exists()


@pytest.mark.parametrize("changes", [
    {"title": ""}, {"title": " "}, {"title": "x" * 251}, {"title": None},
    {"amount": "-0.01"}, {"amount": "1.001"}, {"amount": "NaN"}, {"amount": "Infinity"},
    {"amount": "10000000000000000.00"}, {"amount": None},
    {"currency": "usd"}, {"currency": "ZZZ"}, {"currency": "EURO"}, {"currency": "XXX"},
    {"status": "won"}, {"outcome": "lost"}, {"outcome": "invalid"},
    {"deadline": "not-a-date"}, {"deadline": "2026-12-01"}, {"deadline": "2026-12-01T12:00:00"},
    {"deadline": "2026-02-30T12:00:00Z"}, {"client": "invalid"},
])
def test_invalid_fields(authenticated_api, client_record, changes):
    response = authenticated_api.post("/api/v1/deals", payload(client_record, **changes), format="json")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == 400
    assert not Deal.objects.exists()


@pytest.mark.parametrize("field", ["title", "client", "amount", "currency"])
def test_required_create_and_put_fields(authenticated_api, client_record, deal, field):
    values = payload(client_record)
    del values[field]
    assert authenticated_api.post("/api/v1/deals", values, format="json").status_code == 400
    assert authenticated_api.put(f"/api/v1/deals/{deal.pk}", {**values, "version": 1}, format="json").status_code == 400
    deal.refresh_from_db()
    assert deal.version == 1


@pytest.mark.parametrize("field", ["workspace", "workspace_id", "created_by", "created_by_id", "owner", "id", "paid_at", "created_at", "updated_at", "unexpected"])
def test_ownership_and_server_fields_rejected(authenticated_api, client_record, deal, field):
    assert authenticated_api.post("/api/v1/deals", payload(client_record, **{field: "forged"}), format="json").status_code == 400
    assert authenticated_api.patch(f"/api/v1/deals/{deal.pk}", {field: "forged", "version": 1}, format="json").status_code == 400
    deal.refresh_from_db()
    assert deal.version == 1


@pytest.mark.parametrize("version", [None, 0, -1, True, "1", 1.5, 2147483648])
def test_version_validation(authenticated_api, deal, version):
    path = f"/api/v1/deals/{deal.pk}"
    for method in ["patch", "delete"]:
        assert getattr(authenticated_api, method)(path, {"version": version}, format="json").status_code == 400
    assert authenticated_api.patch(path + "/status", {"status": "paid", "version": version}, format="json").status_code == 400


def test_missing_version_stale_update_and_no_partial_changes(authenticated_api, client_record, deal):
    path = f"/api/v1/deals/{deal.pk}"
    assert authenticated_api.post("/api/v1/deals", payload(client_record, version=1), format="json").status_code == 400
    for method in ["patch", "delete"]:
        assert getattr(authenticated_api, method)(path, {}, format="json").status_code == 400
    assert authenticated_api.patch(path + "/status", {"status": "paid"}, format="json").status_code == 400
    assert authenticated_api.patch(path + "/status", {"version": 1}, format="json").status_code == 400
    updated = authenticated_api.patch(path, {"version": 1, "title": "Saved"}, format="json").json()
    before = Deal.objects.values().get(pk=deal.pk)
    for suffix in ["", "/status"]:
        response = authenticated_api.patch(path + suffix, {"version": 1, "status": "paid"}, format="json")
        assert response.status_code == 409
        assert response.json()["error"]["details"]["detail"] == "This record was updated elsewhere. Reload to see the latest version."
    assert Deal.objects.values().get(pk=deal.pk) == before
    assert authenticated_api.get(path).json() == updated


@pytest.mark.parametrize("initial", Deal.Status.values)
@pytest.mark.parametrize("target", Deal.Status.values)
def test_all_status_transitions(authenticated_api, user, client_record, initial, target):
    response = authenticated_api.post("/api/v1/deals", payload(client_record, status=initial, **({"outcome": "lost"} if initial == "archived" else {})), format="json")
    assert response.status_code == 201
    data = response.json()
    response = authenticated_api.patch(f"/api/v1/deals/{data['id']}/status", {"status": target, "version": 1}, format="json")
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == target and result["version"] == 2
    assert (result["paid_at"] is not None) == (target == "paid")
    if initial == target == "paid":
        assert result["paid_at"] == data["paid_at"]
    assert result["outcome"] == ("lost" if initial == target == "archived" else "none")


@pytest.mark.parametrize("outcome", Deal.Outcome.values)
def test_archived_outcomes_and_reopening(authenticated_api, deal, outcome):
    path = f"/api/v1/deals/{deal.pk}"
    response = authenticated_api.patch(path + "/status", {"version": 1, "status": "archived", "outcome": outcome}, format="json")
    assert response.status_code == 200 and response.json()["outcome"] == outcome
    response = authenticated_api.patch(path, {"version": 2, "title": "Archived edit"}, format="json")
    assert response.json()["outcome"] == outcome
    assert authenticated_api.patch(path + "/status", {"version": 3, "status": "paid", "outcome": "lost"}, format="json").status_code == 400
    response = authenticated_api.patch(path + "/status", {"version": 3, "status": "negotiation"}, format="json")
    assert response.json()["outcome"] == "none"
    assert response.json()["paid_at"] is None


def test_paid_timestamp_lifecycle_and_status_only_input(authenticated_api, deal):
    path = f"/api/v1/deals/{deal.pk}"
    paid = authenticated_api.patch(path, {"version": 1, "status": "paid"}, format="json").json()
    edited = authenticated_api.patch(path, {"version": 2, "amount": "12.34"}, format="json").json()
    assert paid["paid_at"] == edited["paid_at"]
    for field in ["title", "client", "amount", "currency", "deadline"]:
        assert authenticated_api.patch(path + "/status", {"version": 3, "status": "archived", field: "forged"}, format="json").status_code == 400
    reopened = authenticated_api.patch(path + "/status", {"version": 3, "status": "in_progress"}, format="json").json()
    assert reopened["paid_at"] is None
    repaid = authenticated_api.patch(path + "/status", {"version": 4, "status": "paid"}, format="json").json()
    assert repaid["paid_at"] > paid["paid_at"]


def test_colleagues_share_deals_and_deletion(authenticated_api, colleague, deal, client_record):
    team = APIClient(enforce_csrf_checks=True)
    team.force_login(colleague)
    team.credentials(HTTP_X_CSRFTOKEN=team.get("/api/v1/auth/csrf").json()["csrfToken"])
    path = f"/api/v1/deals/{deal.pk}"
    assert team.get("/api/v1/deals").json()["results"][0]["id"] == str(deal.pk)
    assert team.get(path).status_code == 200
    assert team.patch(path, {"title": "Team edit", "version": 1}, format="json").status_code == 200
    assert authenticated_api.get(path).json()["title"] == "Team edit"
    created = team.post("/api/v1/deals", payload(client_record, title="Colleague deal"), format="json")
    assert created.status_code == 201
    assert Deal.objects.get(pk=created.json()["id"]).created_by_id == colleague.pk
    assert authenticated_api.get(f"/api/v1/deals/{created.json()['id']}").status_code == 200
    assert team.delete(path, {"version": 2}, format="json").status_code == 204


def test_foreign_workspace_and_client_ids(authenticated_api, other_user, deal, client_record):
    foreign_client = Client.objects.create(workspace=other_user.workspace_membership.workspace, created_by=other_user, name="Secret company")
    foreign = Deal.objects.create(workspace=foreign_client.workspace, created_by=other_user, client=foreign_client, title="Secret deal", amount="999.99", currency="USD")
    path = f"/api/v1/deals/{foreign.pk}"
    for method in ["get", "put", "patch", "delete"]:
        response = getattr(authenticated_api, method)(path, {"version": 1}, format="json")
        assert response.status_code == 404 and "Secret" not in str(response.json())
    assert authenticated_api.patch(path + "/status", {"version": 1, "status": "paid"}, format="json").status_code == 404
    assert authenticated_api.post("/api/v1/deals", payload(foreign_client), format="json").status_code == 404
    assert authenticated_api.patch(f"/api/v1/deals/{deal.pk}", {"client": str(foreign_client.pk), "version": 1}, format="json").status_code == 404
    assert authenticated_api.post("/api/v1/deals", payload(client_record, client=str(uuid.uuid4())), format="json").status_code == 404
    for search in ["Secret", "Secret company"]:
        assert authenticated_api.get("/api/v1/deals", {"search": search}).json()["results"] == []
    data = authenticated_api.get("/api/v1/deals").json()
    assert data["count"] == 1 and data["totals"] == [{"status": "new_lead", "currency": "EUR", "count": 1, "amount": "1234.56"}]
    assert authenticated_api.get(f"/api/v1/deals/{uuid.uuid4()}").status_code == 404
    Deal.objects.filter(pk=deal.pk).update(client=foreign_client)
    assert authenticated_api.get(f"/api/v1/deals/{deal.pk}").status_code == 404
    assert authenticated_api.get("/api/v1/deals").json()["count"] == 0


@pytest.mark.parametrize("route,method", [("", "get"), ("", "post"), ("/detail", "get"), ("/detail", "put"), ("/detail", "patch"), ("/detail", "delete"), ("/status", "patch")])
def test_authentication_and_missing_membership(api, user, deal, route, method):
    path = "/api/v1/deals" + (f"/{deal.pk}/status" if route == "/status" else f"/{deal.pk}" if route else "")
    assert getattr(api, method)(path, {}, format="json").status_code == 403
    api.force_login(user)
    api.credentials(HTTP_X_CSRFTOKEN=api.get("/api/v1/auth/csrf").json()["csrfToken"])
    WorkspaceMembership.objects.filter(user=user).delete()
    assert getattr(api, method)(path, {}, format="json").status_code == 403


@pytest.mark.parametrize("method,suffix", [("post", "list"), ("put", ""), ("patch", ""), ("delete", ""), ("patch", "/status")])
def test_csrf_and_untrusted_origin(api, authenticated_api, user, deal, client_record, method, suffix):
    api.force_login(user)
    api.credentials()
    path = "/api/v1/deals" if suffix == "list" else f"/api/v1/deals/{deal.pk}{suffix}"
    values = payload(client_record, version=1, status="paid")
    assert getattr(api, method)(path, values, format="json").status_code == 403
    api.credentials(HTTP_X_CSRFTOKEN=api.get("/api/v1/auth/csrf").json()["csrfToken"])
    assert getattr(api, method)(path, values, format="json", HTTP_ORIGIN="https://untrusted.example").status_code == 403
    deal.refresh_from_db()
    assert deal.version == 1


def test_empty_filters_search_pagination_and_currency_totals(authenticated_api, user, client_record):
    assert authenticated_api.get("/api/v1/deals").json() == {"count": 0, "next": None, "previous": None, "results": [], "totals": []}
    stamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    entries = [(1, "10.10", "EUR", "new_lead"), (2, "0.20", "EUR", "new_lead"), (3, "7.00", "USD", "new_lead"), (4, "2.00", "EUR", "archived")]
    for number, amount, currency, status in entries:
        record = Deal.objects.create(id=uuid.UUID(int=number), workspace=client_record.workspace, created_by=user, client=client_record, title="Project", amount=amount, currency=currency, status=status)
        Deal.objects.filter(pk=record.pk).update(created_at=stamp + timedelta(days=1 if number == 1 else 0))
    first = authenticated_api.get("/api/v1/deals?page_size=2").json()
    second = authenticated_api.get("/api/v1/deals?page_size=2&page=2").json()
    assert [row["id"] for row in first["results"] + second["results"]] == [str(uuid.UUID(int=n)) for n in [1, 4, 3, 2]]
    assert first["count"] == 4 and first["next"] and second["previous"]
    assert first["totals"] == second["totals"] == [
        {"status": "archived", "currency": "EUR", "count": 1, "amount": "2.00"},
        {"status": "new_lead", "currency": "EUR", "count": 2, "amount": "10.30"},
        {"status": "new_lead", "currency": "USD", "count": 1, "amount": "7.00"},
    ]
    filtered = authenticated_api.get("/api/v1/deals?status=new_lead&currency=EUR&page_size=1").json()
    assert filtered["count"] == 2 and filtered["totals"] == [first["totals"][1]]
    for query in ["Project", "Acme"]:
        assert authenticated_api.get("/api/v1/deals", {"search": query}).json()["count"] == 4
    assert authenticated_api.get("/api/v1/deals?search=missing").json()["totals"] == []
    assert authenticated_api.get("/api/v1/deals?page=999").status_code == 404
    assert authenticated_api.get("/api/v1/deals?status=invalid").status_code == 400
    assert authenticated_api.get("/api/v1/deals?currency=ZZZ").status_code == 400
    assert authenticated_api.get("/api/v1/deals?currency=usd").status_code == 400
    capped = authenticated_api.get("/api/v1/deals?page_size=100000").json()
    assert len(capped["results"]) == 4


def test_page_size_cap_and_version_exhaustion(authenticated_api, user, client_record, deal):
    Deal.objects.bulk_create([
        Deal(workspace=client_record.workspace, created_by=user, client=client_record, title=f"Project {number}", amount="1.00", currency="EUR")
        for number in range(100)
    ])
    response = authenticated_api.get("/api/v1/deals?page_size=100000").json()
    assert response["count"] == 101
    assert len(response["results"]) == 100 and response["next"]
    assert response["totals"] == [{"status": "new_lead", "currency": "EUR", "count": 101, "amount": "1334.56"}]
    Deal.objects.filter(pk=deal.pk).update(version=2147483647)
    before = Deal.objects.values().get(pk=deal.pk)
    assert authenticated_api.patch(f"/api/v1/deals/{deal.pk}", {"version": 2147483647, "title": "Overflow"}, format="json").status_code == 409
    assert Deal.objects.values().get(pk=deal.pk) == before


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("status_only", [False, True])
def test_two_concurrent_patches_use_atomic_compare_and_swap(user, colleague, client_record, deal, monkeypatch, status_only):
    assert connection.vendor == "postgresql"
    barrier = Barrier(2, timeout=10)
    original_update = QuerySet.update
    queries = []

    def synchronized_update(queryset, **values):
        if queryset.model is Deal and "version" in values:
            queries.append(str(queryset.query))
            barrier.wait()
        return original_update(queryset, **values)

    monkeypatch.setattr(QuerySet, "update", synchronized_update)

    def write(actor, value):
        close_old_connections()
        try:
            api = APIClient()
            api.force_authenticate(user=actor)
            suffix = "/status" if status_only else ""
            values = {"status" if status_only else "title": value, "version": 1}
            response = api.patch(f"/api/v1/deals/{deal.pk}{suffix}", values, format="json")
            return response.status_code, response.json()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(write, user, "paid" if status_only else "First edit")
        second = executor.submit(write, colleague, "archived" if status_only else "Second edit")
        results = [first.result(timeout=20), second.result(timeout=20)]
    assert sorted(status for status, data in results) == [200, 409]
    winner = next(data for status, data in results if status == 200)
    deal.refresh_from_db()
    assert deal.title == winner["title"] and deal.status == winner["status"] and deal.version == 2
    assert len(queries) == 2
    assert all('"version" = 1' in query for query in queries)
    assert Deal.objects.count() == 1
