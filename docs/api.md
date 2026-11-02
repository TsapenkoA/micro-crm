# Day 1–2 API

The base path is `/api/v1`, without a trailing slash. Responses use JSON. Sessions use the `sessionid` cookie with HttpOnly and SameSite=Lax. Secure is disabled for local HTTP; production policies must be configured separately.

| Method and path | Access | Response |
| --- | --- | --- |
| GET /health | Public | 200 `{"status":"ok","database":"ok"}`; 503 if the database is unavailable |
| GET /auth/csrf | Public | 200 `{"csrfToken":"..."}` and a csrftoken cookie |
| POST /auth/login | CSRF required | JSON `{"username":"alex","password":"..."}` → 200 `{"user":{"id":1,"username":"alex","email":""},"csrfToken":"..."}` |
| GET /auth/me | Session | 200 `{"user":{"id":1,"username":"alex","email":""}}` |
| POST /auth/logout | Session + CSRF | 204 with no body; the session is deleted |

Before login, fetch `/auth/csrf` and send the token in `X-CSRFToken` along with cookies. Login rotates the CSRF cookie; use the new csrfToken from its response. After restoring a session, fetch the token again through `/auth/csrf` if needed. The frontend does this before logout. Vite proxy preserves a single origin; requests from an untrusted Origin are rejected.

400 indicates field validation errors. 403 indicates invalid credentials, an inactive account, a missing session, or a CSRF failure. 405 indicates a disallowed method. DRF and CSRF errors use the envelope `{"error":{"code":403,"details":"..."}}`; details may be a string or a field object. Health uses the separate format shown in the table. HTTP 500 with DEBUG=False returns a generic JSON message without internal details; DEBUG=True is for local development only. Application messages use English.

Clients, Deals, Invoices, and Analytics APIs are not connected yet. The base helper/mixin filters root resources by owner before lookup, so another owner's UUID returns 404. Actual CRUD contracts will be added in their respective phases. Login throttling and production perimeter protection require separate configuration before public deployment.
