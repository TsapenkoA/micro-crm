# API

The base path is `/api/v1`, without a trailing slash. DRF endpoints use JSONRenderer only, including browser requests that accept JSON through a wildcard; there is no browsable HTML API. Sessions use the `sessionid` cookie with HttpOnly and SameSite=Lax. Secure is disabled for local HTTP; production policies must be configured separately.

| Method and path | Access | Response |
| --- | --- | --- |
| GET /health | Public | 200 `{"status":"ok","database":"ok"}`; 503 if the database is unavailable |
| GET /auth/csrf | Public | 200 `{"csrfToken":"..."}` and a csrftoken cookie |
| POST /auth/login | CSRF required | JSON `{"username":"alex","password":"..."}` → 200 `{"user":{"id":1,"username":"alex","email":"","workspace":{"id":"<uuid>","name":"Example Studio"}},"csrfToken":"..."}` |
| GET /auth/me | Session | 200 `{"user":{"id":1,"username":"alex","email":"","workspace":{"id":"<uuid>","name":"Example Studio"}}}` |
| POST /auth/logout | Session + CSRF | 204 with no body; the session is deleted |

Before login, fetch `/auth/csrf` and send the token in `X-CSRFToken` along with cookies. Login rotates the CSRF cookie; use the new csrfToken from its response. After restoring a session, fetch the token again through `/auth/csrf` if needed. The frontend does this before logout. Vite proxy preserves a single origin; requests from an untrusted Origin are rejected.

The user DTO reports only the signed-in user's workspace ID and name, for display in navigation and Settings. It does not accept company assignment. An account without membership receives `workspace: null`; protected business endpoints still deny access with 403.

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

Deals CRUD, Invoices, and Analytics APIs remain unimplemented. Client detail includes read-only related deals; notes and links are loaded through the nested endpoints below. Login throttling and production perimeter protection require separate configuration before public deployment.

## Client notes and links

| Method and path | Result |
| --- | --- |
| GET /clients/{uuid}/notes | 200 paginated notes in chronological order |
| POST /clients/{uuid}/notes | 201 created note |
| DELETE /clients/{uuid}/notes/{note_uuid} | 204 deleted note; only its author may delete it |
| GET /clients/{uuid}/links | 200 paginated links in chronological order |
| POST /clients/{uuid}/links | 201 created link |

All routes require a session and workspace membership; POST also requires CSRF. The server resolves the parent client through the current workspace before reading children or validating creation input. A foreign or missing parent returns 404, including writes. Every member of the workspace can read all history and add their own notes or shared links. No per-client roles or realtime channel is used.

Both lists use `created_at`, then `id`, ascending. Pagination matches the client list envelope with a default page size of 20 and maximum of 100. Example: `GET /api/v1/clients/{uuid}/notes?page=1&page_size=20`. An empty list is `{"count":0,"next":null,"previous":null,"results":[]}`.

Note request:

```json
{"text":"Kickoff completed.\nWaiting for the revised brief."}
```

Note response:

```json
{
  "id":"75d69ec1-4651-4bd3-940f-a6d0c56ee21f",
  "client":"e2e9551e-f277-4fce-80ee-1bc0b7e03bdf",
  "author":{"id":1,"username":"alex"},
  "text":"Kickoff completed.\nWaiting for the revised brief.",
  "created_at":"2026-01-01T12:00:00Z",
  "can_delete":true
}
```

Only text is writable. It must be nonblank and at most 10,000 characters; surrounding whitespace is trimmed and internal line breaks are retained. The author is the current session's User, and the timestamp comes from the backend. Client, author/author_id, workspace, IDs, timestamps, and unknown fields are rejected with 400. Notes are plain text, not HTML; markup-looking input is stored as text and rendered by React without HTML interpretation.

`can_delete` is a read-only hint calculated for the current session: true only when the current user authored the note. It cannot be supplied in write input. The DELETE endpoint independently enforces session authentication, CSRF, workspace membership, the parent-client relationship, and authorship. A colleague of the same workspace receives 403 when deleting another author's note, including superusers. A foreign/missing client, missing note, or a note belonging to a different parent returns 404. Repeating a successful DELETE returns 404. Membership, client, and note are locked during deletion; only the selected note is removed.

Link request:

```json
{"label":"Project brief","url":"https://docs.google.com/document/d/example"}
```

Link response:

```json
{
  "id":"a98e1931-fb17-40d6-83c5-157bccdd1a1f",
  "client":"e2e9551e-f277-4fce-80ee-1bc0b7e03bdf",
  "label":"Project brief",
  "url":"https://docs.google.com/document/d/example",
  "created_at":"2026-01-01T12:00:00Z"
}
```

Only label and url are writable. Label is required, nonblank, and at most 200 characters. URL is required, at most 2,048 characters, and must use a complete http:// or https:// address accepted by Django URL validation. javascript:, data:, file:, ftp:, and protocol-relative URLs are rejected. External URLs are never fetched by the backend. Validation errors retain the existing envelope, for example `{"error":{"code":400,"details":{"url":["Enter a valid URL."]}}}`.

Notes support creation, reading, and author-only deletion; note editing is not implemented. Links support creation and reading only. ClientLink has no personal ownership field, so no unsupported "own link" deletion rule is inferred. Clients with remaining notes/links still return 409 on deletion; no history is silently cascaded away. No schema migration is required for these endpoints.

## Clients frontend integration

The Clients page at `#/clients` consumes these endpoints through the shared session/CSRF API client. It sends only name, company, email, and phone for create/update; workspace and creator are never submitted. Email and phone are optional, matching the backend model. Search runs on explicit submission. Pagination uses the response's next/previous availability and page numbers, with newest-first server ordering.

Create and edit forms map 400 field errors to their corresponding inputs and preserve entered values after failure. The UI reports 403 access/session errors, 404 missing clients, 409 protected deletion, server failures, and network loss without displaying internal response text. After restoring a session, the shared client obtains CSRF before its first write. A 403 clears the cached token for the next attempt; writes are not automatically retried.

Successful create/update/delete operations refetch the list without reloading the page. Refresh performs another list request so colleagues can see each other's changes. The UI does not filter by created_by. Client data is discarded when the authenticated user changes. The list does not display deal counts because list responses do not provide them; the detail drawer displays the actual related deals and count from GET detail.

The drawer loads notes and links independently, with loading, empty, error, refresh, and pagination states. It shows each note's username, backend timestamp formatted in local time, and plain text with preserved line breaks. A successful POST clears that form and refetches the last chronological page so the new entry is visible. Failed writes keep the draft and never insert a local timeline item. Server field errors are attached to the relevant input. Colleagues see changes after refreshing history or reopening the drawer.

For notes with can_delete=true, Delete note opens an inline confirmation with Cancel and Confirm deletion. Pending deletion disables duplicate requests. The note is retained until the server confirms deletion; failures keep the note and show an error. Success refetches the last available chronological page, including when the last note on a page was removed. There is no undo or automatic deletion of related records.

External links open with target="_blank" and rel="noopener noreferrer". The frontend additionally refuses to activate any legacy URL with an unsupported scheme. Existing read-only deals remain visible when returned by the API, alongside an explicit message that deal management is not implemented; no fake deals are introduced.

Only client creation is connected in global quick actions. Deal and invoice actions are disabled and marked Coming soon. Detail opening leaves the list mounted; Escape closes the drawer and focus returns to the trigger when it remains available.
