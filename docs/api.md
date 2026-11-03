# API

The base path is `/api/v1`, without a trailing slash. DRF endpoints use JSONRenderer only, including browser requests that accept JSON through a wildcard; there is no browsable HTML API. Sessions use the `sessionid` cookie with HttpOnly and SameSite=Lax. Secure is disabled for local HTTP; production policies must be configured separately.

| Method and path | Access | Response |
| --- | --- | --- |
| GET /health | Public | 200 `{"status":"ok","database":"ok"}`; 503 if the database is unavailable |
| GET /auth/csrf | Public | 200 `{"csrfToken":"..."}` and a csrftoken cookie |
| POST /auth/login | CSRF required | JSON `{"username":"alex","password":"..."}` → 200 `{"user":{"id":1,"username":"alex","email":""},"csrfToken":"..."}` |
| GET /auth/me | Session | 200 `{"user":{"id":1,"username":"alex","email":""}}` |
| POST /auth/logout | Session + CSRF | 204 with no body; the session is deleted |

Before login, fetch `/auth/csrf` and send the token in `X-CSRFToken` along with cookies. Login rotates the CSRF cookie; use the new csrfToken from its response. After restoring a session, fetch the token again through `/auth/csrf` if needed. The frontend does this before logout. Vite proxy preserves a single origin; requests from an untrusted Origin are rejected.

400 indicates field validation errors. 403 indicates invalid credentials, an inactive account, a missing session, or a CSRF failure. 405 indicates a disallowed method. DRF and CSRF errors use the envelope `{"error":{"code":403,"details":"..."}}`; details may be a string or a field object. Health uses the separate format shown in the table. HTTP 500 with DEBUG=False returns a generic JSON message without internal details; DEBUG=True is for local development only. Application messages use English.

## Clients

All routes below require a session and a workspace membership. Writes also require CSRF. Members of one workspace share access; objects in another workspace return the same 404 as missing objects. There is no superuser bypass and no workspace selector in request input.

| Method and path | Result |
| --- | --- |
| GET /clients | 200 paginated clients in the current workspace |
| POST /clients | 201 created client |
| GET /clients/{uuid} | 200 client with related workspace deals, or 404 |
| PUT /clients/{uuid} | 200 updated client; name required |
| PATCH /clients/{uuid} | 200 partially updated client |
| DELETE /clients/{uuid} | 204 with no body, 404 if missing/foreign, 409 if related records protect deletion |

Only name, company, email, and phone are writable. Name is required and cannot be blank; maximum lengths are 200, 200, 254, and 50 respectively. Email must be valid or blank. Optional fields may be blank but not null. Phone is a free-form string, with no national format restriction. Strings are trimmed. PUT requires name; omitted optional fields retain their existing values, and explicit empty strings clear them. PATCH preserves omitted fields.

ID, workspace, created_by, timestamps, workspace_id, legacy owner fields, and unknown fields in write input are rejected with 400. Workspace and created_by are assigned from the authenticated user and cannot be changed through CRUD.

Create request (send the session cookie and current X-CSRFToken):

```http
POST /api/v1/clients
Content-Type: application/json
X-CSRFToken: <current-token>

{"name":"Alex Morgan","company":"Acme Studio","email":"alex@example.com","phone":"+49 123 456"}
```

Response shape for create/update and individual list entries:

```json
{
  "id": "e2e9551e-f277-4fce-80ee-1bc0b7e03bdf",
  "workspace": "b5c080f9-f80a-465a-813e-a929c7d75d25",
  "created_by": 1,
  "name": "Alex Morgan",
  "company": "Acme Studio",
  "email": "alex@example.com",
  "phone": "+49 123 456",
  "created_at": "2026-11-03T10:00:00Z",
  "updated_at": "2026-11-03T10:00:00Z"
}
```

GET /clients/{uuid} returns the same client fields plus a read-only `deals` array. It includes only deals linked to this client and belonging to the authenticated user's workspace, ordered by created_at descending and UUID descending. If no matching deals exist, `deals` is `[]`. Each deal contains id, title, status, amount (Decimal string), currency, and deadline (UTC ISO 8601 or null):

```json
{
  "deals": [
    {
      "id": "f4a0c70f-97af-4b6b-b4c8-3672f00a3a95",
      "title": "Website design",
      "status": "in_progress",
      "amount": "1500.00",
      "currency": "EUR",
      "deadline": null
    }
  ]
}
```

This example shows the additional field only; the response also contains the client fields above. List/create/PUT/PATCH responses do not include deals. Writes to deals are rejected as non-writable input. There is no Deals CRUD endpoint.

List query example: `GET /api/v1/clients?search=acme&page=1&page_size=20`. Search uses case-insensitive partial matching on name, company, and email; standard DRF SearchFilter terms apply (each term must match at least one searched field). Search runs only within the current workspace. Sorting is fixed by created_at descending, then UUID descending (`-created_at`, `-id`), with newest clients first. The UUID tie-breaker provides deterministic ordering when timestamps match. Page size defaults to 20 and is capped at 100. Invalid/out-of-range pages return 404. Page-number pagination does not guarantee a fixed snapshot during concurrent edits or insertions.

List envelope: `{"count":1,"next":null,"previous":null,"results":[...]}`. Empty result: `{"count":0,"next":null,"previous":null,"results":[]}`. next/previous are absolute page URLs when present.

```http
GET /api/v1/clients/e2e9551e-f277-4fce-80ee-1bc0b7e03bdf

PUT /api/v1/clients/e2e9551e-f277-4fce-80ee-1bc0b7e03bdf
Content-Type: application/json
X-CSRFToken: <current-token>

{"name":"Alex Morgan","company":"Updated Studio","email":"new@example.com","phone":""}

PATCH /api/v1/clients/e2e9551e-f277-4fce-80ee-1bc0b7e03bdf
Content-Type: application/json
X-CSRFToken: <current-token>

{"company":"Another Studio"}

DELETE /api/v1/clients/e2e9551e-f277-4fce-80ee-1bc0b7e03bdf
X-CSRFToken: <current-token>
```

Validation example: `{"error":{"code":400,"details":{"email":["Enter a valid email address."]}}}`. A missing membership returns 403. Deletion protected by an invoice, deal, note, or link returns `{"error":{"code":409,"details":{"detail":"This client has related records and cannot be deleted. Remove or resolve those records first."}}}` without internal object IDs. No child is cascaded away.

Notes/links APIs, Deals CRUD, Invoices, and Analytics APIs remain unimplemented. Client detail includes read-only related deals; history is not available yet. Login throttling and production perimeter protection require separate configuration before public deployment.

## Clients frontend integration

The Clients page at `#/clients` consumes these endpoints through the shared session/CSRF API client. It sends only name, company, email, and phone for create/update; workspace and creator are never submitted. Email and phone are optional, matching the backend model. Search runs on explicit submission. Pagination uses the response's next/previous availability and page numbers, with newest-first server ordering.

Create and edit forms map 400 field errors to their corresponding inputs and preserve entered values after failure. The UI reports 403 access/session errors, 404 missing clients, 409 protected deletion, server failures, and network loss without displaying internal response text. After restoring a session, the shared client obtains CSRF before its first write. A 403 clears the cached token for the next attempt; writes are not automatically retried.

Successful create/update/delete operations refetch the list without reloading the page. Refresh performs another list request so colleagues can see each other's changes. The UI does not filter by created_by. Client data is discarded when the authenticated user changes. The list does not display deal counts because list responses do not provide them; the detail drawer displays the actual related deals and count from GET detail.

Only client creation is connected in global quick actions. Deal and invoice actions are disabled and marked Coming soon. Notes and links are explicit placeholders, not fabricated records. Detail opening leaves the list mounted; Escape closes the drawer and focus returns to the trigger when it remains available.
