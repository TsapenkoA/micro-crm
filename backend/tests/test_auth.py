import pytest

pytestmark = pytest.mark.django_db


def login(api, user):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    return api.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json", HTTP_X_CSRFTOKEN=token)


def test_login_me_logout_and_csrf_rotation(api, user):
    old_token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    old_cookie = api.cookies["csrftoken"].value
    response = login(api, user)
    assert response.status_code == 200
    assert response.json()["user"] == {"id": user.pk, "username": user.username, "email": user.email}
    assert api.cookies["csrftoken"].value != old_cookie
    assert api.cookies["sessionid"]["httponly"]
    assert api.get("/api/v1/auth/me").json()["user"]["id"] == user.pk
    assert api.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=old_token).status_code == 403
    token = response.json()["csrfToken"]
    assert api.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=token).status_code == 204
    assert api.get("/api/v1/auth/me").status_code == 403


def test_login_rejects_missing_csrf_even_before_authentication(api, user):
    response = api.post("/api/v1/auth/login", {"username": user.username, "password": "test-password-123"}, format="json")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == 403


def test_login_rejects_bad_csrf_and_untrusted_origin(api, user):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    fields = {"username": user.username, "password": "test-password-123"}
    assert api.post("/api/v1/auth/login", fields, format="json", HTTP_X_CSRFTOKEN="invalid").status_code == 403
    assert api.post("/api/v1/auth/login", fields, format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://untrusted.example").status_code == 403


def test_invalid_credentials_and_inactive_user(api, user):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    response = api.post("/api/v1/auth/login", {"username": user.username, "password": "incorrect"}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 403
    assert api.get("/api/v1/auth/me").status_code == 403
    user.is_active = False
    user.save()
    assert login(api, user).status_code == 403


def test_login_validation_and_method_restrictions(api):
    token = api.get("/api/v1/auth/csrf").json()["csrfToken"]
    assert api.post("/api/v1/auth/login", {}, format="json", HTTP_X_CSRFTOKEN=token).status_code == 400
    assert api.get("/api/v1/auth/login").status_code == 405
    assert api.get("/api/v1/auth/logout").status_code == 403


def test_logout_requires_csrf_and_session(api, user):
    assert api.post("/api/v1/auth/logout").status_code == 403
    login(api, user)
    assert api.post("/api/v1/auth/logout").status_code == 403


def test_session_cannot_be_reused_after_logout(api, user):
    response = login(api, user)
    session_id = api.cookies["sessionid"].value
    api.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=response.json()["csrfToken"])
    api.cookies["sessionid"] = session_id
    assert api.get("/api/v1/auth/me").status_code == 403
