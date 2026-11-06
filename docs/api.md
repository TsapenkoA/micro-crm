# API

The base path is `/api/v1`, without a trailing slash. DRF endpoints use JSONRenderer only, including browser requests that accept JSON through a wildcard; there is no browsable HTML API. Sessions use the `sessionid` cookie with HttpOnly and SameSite=Lax. Secure is disabled for local HTTP; production policies must be configured separately.

| Method and path | Access | Response |
| --- | --- | --- |
| GET /health | Public | 200 `{"status":"ok","database":"ok"}`; 503 if the database is unavailable |
| GET /auth/csrf | Public | 200 `{"csrfToken":"..."}` and a csrftoken cookie |
| POST /auth/login | CSRF required | JSON `{"username":"alex","password":"..."}` → 200 `{"user":{"id":1,"username":"alex","email":"","workspace":{"id":"<uuid>","name":"Example Studio"}},"csrfToken":"..."}` |
| GET /auth/me | Session | 200 `{"user":{"id":1,"username":"alex","email":"","workspace":{"id":"<uuid>","name":"Example Studio"}}}` |
| POST /auth/logout | Session + CSRF | 204 with no body; the session is deleted |
| POST /auth/sign-up | CSRF | username, email, password, password_confirm → 201 user and rotated csrfToken |
| PATCH /auth/profile | Session + CSRF | username only → 200 user with refreshed workspace display |
| POST /auth/forgot-password | CSRF | email → neutral 202 message, regardless of eligibility |
| POST /auth/reset-password | CSRF | uid, token, password, password_confirm → 200; invalid/expired/reused token gives 400 |
| POST /auth/password | Session + CSRF | password, password_confirm, current_password when already set → 200 |
| POST /auth/reauthenticate | Session + CSRF | password → 200; verification lasts five minutes |
| GET /auth/providers | Public | providers: array of id, name, configured; no secrets |
| GET /auth/methods | Session | password: boolean, recent_auth: boolean, providers: connected IDs |
| DELETE /auth/providers/{provider} | Recent session + CSRF | 204; 400 for last-method removal, 403 for stale verification, 404 if absent |
| POST /auth/oauth/{provider}/start | CSRF; recent session for connect | process: login or connect → 200 with provider authorization url |
| GET /auth/oauth/{provider}/callback/ | Session-bound OAuth state | Server-side exchange, then 302 to the fixed frontend result |

Before login, fetch `/auth/csrf` and send the token in `X-CSRFToken` along with cookies. Login rotates the CSRF cookie; use the new csrfToken from its response. After restoring a session, fetch the token again through `/auth/csrf` if needed. The frontend does this before logout. Vite proxy preserves a single origin; requests from an untrusted Origin are rejected.

The user DTO reports only the signed-in user's workspace ID and name, for display in navigation and Settings. It does not accept company assignment. An account without membership receives `workspace: null`; protected business endpoints still deny access with 403.

`GET /api/v1/workspace/counts` returns `{ "clients": 5, "deals": 11, "invoices": 6 }` for the signed-in user's workspace. It requires a session and workspace membership. The application uses these database counts for navigation badges; a failed request leaves the badges hidden.

Login accepts either username (including email entered in that field) or email, plus password. Email lookup is case-insensitive and rejects ambiguous legacy addresses. Signup creates an independent workspace, ignores company assignment input, validates passwords with Django and rejects existing primary/social email identities. Concurrent public creation is serialized by email. Password reset clears the requesting session and invalidates previous sessions. A social-only user sets the first password after a recent provider sign-in; a password user submits current_password.

OAuth provider IDs are google, github and microsoft. Missing credentials return configured=false; start returns 404. django-allauth generates the authorization URL and handles state, PKCE and callback processing on the server. Callback routes deliberately retain the slash registered with providers. Errors/collisions redirect to /oauth-result with a fixed status, without internal exceptions or credentials. No automatic email-based social merging is enabled. See [authentication.md](authentication.md) for setup and verification rules.

Auth write limits return 429 in the standard error envelope and Retry-After. Limits and cleanup commands are in [authentication.md](authentication.md). Forgot-password 202 does not guarantee delivery; development uses console email.

Username is required for password signup, has a 150-character limit, uses Django's Unicode username validation, and excludes @ to keep username/email login unambiguous. Usernames are checked case-insensitively; signup/profile changes serialize same-name claims with an advisory lock. Profile updates affect only the signed-in user and reject other fields. IDs, authorship, sessions and existing business records are preserved. An automatically generated personal workspace name follows a username change only when it still equals the old username plus "'s workspace" and has exactly one member. Custom/shared company names are never renamed by this endpoint.

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

{"name":"Sample Client","company":"Sample Studio","email":"client@example.test","phone":"+49 123 456"}
```

Response shape for create/update and individual list entries:

```json
{
  "id": "e2e9551e-f277-4fce-80ee-1bc0b7e03bdf",
  "workspace": "b5c080f9-f80a-465a-813e-a929c7d75d25",
  "created_by": 1,
  "name": "Sample Client",
  "company": "Sample Studio",
  "email": "client@example.test",
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

This example shows the additional field only; the response also contains the client fields above. List/create/PUT/PATCH responses do not include the `deals` array. Writes to `deals` are rejected as non-writable input. Deal CRUD uses the separate endpoints below.

List query example: `GET /api/v1/clients?search=acme&page=1&page_size=20`. Search uses case-insensitive partial matching on name, company, and email; standard DRF SearchFilter terms apply (each term must match at least one searched field). Search runs only within the current workspace. Sorting is fixed by created_at descending, then UUID descending (`-created_at`, `-id`), with newest clients first. The UUID tie-breaker provides deterministic ordering when timestamps match. Page size defaults to 20 and is capped at 100. Invalid/out-of-range pages return 404. Page-number pagination does not guarantee a fixed snapshot during concurrent edits or insertions.

List envelope: `{"count":1,"next":null,"previous":null,"results":[...]}`. Each list item includes a read-only `deal_count`, computed from deals in the authenticated workspace; create/update/detail responses omit this list-only field. An empty list is `{"count":0,"next":null,"previous":null,"results":[]}`. next/previous are absolute page URLs when present.

```http
GET /api/v1/clients/e2e9551e-f277-4fce-80ee-1bc0b7e03bdf

PUT /api/v1/clients/e2e9551e-f277-4fce-80ee-1bc0b7e03bdf
Content-Type: application/json
X-CSRFToken: <current-token>

{"name":"Sample Client","company":"Updated Studio","email":"new@example.test","phone":""}

PATCH /api/v1/clients/e2e9551e-f277-4fce-80ee-1bc0b7e03bdf
Content-Type: application/json
X-CSRFToken: <current-token>

{"company":"Another Studio"}

DELETE /api/v1/clients/e2e9551e-f277-4fce-80ee-1bc0b7e03bdf
X-CSRFToken: <current-token>
```

Validation example: `{"error":{"code":400,"details":{"email":["Enter a valid email address."]}}}`. A missing membership returns 403. Deletion protected by an invoice, deal, note, or link returns `{"error":{"code":409,"details":{"detail":"This client has related records and cannot be deleted. Remove or resolve those records first."}}}` without internal object IDs. No child is cascaded away.

Deals and Invoices APIs are documented below. Analytics remains unimplemented. Client detail includes read-only related deals; notes and links are loaded through the nested endpoints below. Production perimeter protection requires separate configuration before public deployment.

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

Successful create/update/delete operations refetch the list without reloading the page. Refresh performs another list request so colleagues can see each other's changes. The UI does not filter by created_by. Client data is discarded when the authenticated user changes. The list displays the server's workspace-scoped `deal_count`; the detail drawer displays the actual related deals from GET detail.

The drawer loads notes and links independently, with loading, empty, error, refresh, and pagination states. It shows each note's username, backend timestamp formatted in local time, and plain text with preserved line breaks. A successful POST clears that form and refetches the last chronological page so the new entry is visible. Failed writes keep the draft and never insert a local timeline item. Server field errors are attached to the relevant input. Colleagues see changes after refreshing history or reopening the drawer.

For notes with can_delete=true, Delete note opens an inline confirmation with Cancel and Confirm deletion. Pending deletion disables duplicate requests. The note is retained until the server confirms deletion; failures keep the note and show an error. Success refetches the last available chronological page, including when the last note on a page was removed. There is no undo or automatic deletion of related records.

External links open with target="_blank" and rel="noopener noreferrer". The frontend additionally refuses to activate any legacy URL with an unsupported scheme. Related deals returned by GET client detail link to their real side panel in the connected Deals section.

Client and deal creation are connected in global quick actions. Invoice creation remains disabled and marked Coming soon. Detail opening leaves the list mounted; Escape closes the drawer and focus returns to the trigger when it remains available.

## Deals

All paths below use the `/api/v1` prefix and have no trailing slash. Session authentication and workspace membership are required; every write requires CSRF. Colleagues share all workspace deals regardless of creator. Foreign/missing deals and foreign/missing client UUIDs return 404. Invalid UUID input returns 400. Stored deals with an inconsistent client workspace are excluded from reads and mutations.

| Method and path | Result |
| --- | --- |
| GET /deals | 200 paginated deals and totals |
| POST /deals | 201 created deal, version 1 |
| GET /deals/{uuid} | 200 deal |
| PUT /deals/{uuid} | 200 updated deal; required title, client, amount, currency, version |
| PATCH /deals/{uuid} | 200 updated deal; version required |
| DELETE /deals/{uuid} | 204; JSON body with current version required |
| PATCH /deals/{uuid}/status | 200 updated deal; status and version required, optional outcome |

Create example (use the current session's CSRF token):

```http
POST /api/v1/deals
Content-Type: application/json
X-CSRFToken: <current-token>

{"title":"Website redesign","client":"e2e9551e-f277-4fce-80ee-1bc0b7e03bdf","amount":"1500.25","currency":"EUR","deadline":"2026-12-01T15:00:00+03:00"}
```

Response:

```json
{
  "id":"868b5064-7548-49cf-bba3-ea0ae5cd9ef2",
  "title":"Website redesign",
  "client":"e2e9551e-f277-4fce-80ee-1bc0b7e03bdf",
  "status":"new_lead",
  "amount":"1500.25",
  "currency":"EUR",
  "deadline":"2026-12-01T12:00:00Z",
  "version":1,
  "outcome":"none",
  "paid_at":null,
  "created_at":"2026-11-04T12:00:00Z",
  "updated_at":"2026-11-04T12:00:00Z"
}
```

Title is trimmed, required and limited to 250 characters. Amount is nonnegative Decimal with up to 16 integer and 2 fractional digits; JSON amounts and sums are strings. Currency must be an uppercase current ISO 4217 currency/fund code with defined minor units. The bundled allowlist comes from [SIX List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml), published 2026-09-17; unknown, withdrawn, test and no-currency codes are rejected. The existing deal schema always stores two decimal places, without currency conversion or invoice rounding logic. Deadline is optional/null or an ISO 8601 datetime with explicit `Z`/`±HH:MM`; output is UTC. Past deadlines are allowed for overdue deals.

Writable fields are title, client, status, amount, currency, deadline and outcome. Version is a precondition for updates/deletion, not an assignable new value. Creation rejects supplied version; workspace, creator, IDs, paid_at, timestamps and unknown input fields are rejected with 400. Invalid business fields return the standard field-error envelope. Default status/outcome are new_lead/none.

All five statuses (`new_lead`, `negotiation`, `in_progress`, `paid`, `archived`) can move to any other status, including reopening an archived or paid deal. Repeating the current status is allowed and increments version. Entering paid sets paid_at on the server; edits while paid retain it; leaving paid clears it; re-entering paid assigns a new timestamp. This records manual pipeline state and never changes an invoice or records revenue/payment processing.

Archived accepts outcome `none`, `lost` or `cancelled`; entering it does not imply lost. An omitted archived outcome defaults to none, or retains the current archived outcome when already archived. Leaving archived resets outcome to none; explicitly supplying lost/cancelled outside archived returns 400. The status endpoint accepts only status, outcome and version.

```http
PATCH /api/v1/deals/868b5064-7548-49cf-bba3-ea0ae5cd9ef2/status
Content-Type: application/json
X-CSRFToken: <current-token>

{"status":"archived","outcome":"cancelled","version":1}
```

Updates use a direct PostgreSQL compare-and-swap: `UPDATE ... SET version = version + 1 ... WHERE id = ... AND workspace_id = ... AND version = ...`. Exactly one competing write with the same current version succeeds; stale requests return 409 and change nothing. Successful PUT/PATCH/status responses include the incremented version and full DTO. Missing/invalid version returns 400; version exhaustion returns 409 instead of overflowing. Reload GET detail before retrying a conflict. A successful PATCH with no changed business values still increments version.

```json
{"error":{"code":409,"details":{"detail":"This record was updated elsewhere. Reload to see the latest version."}}}
```

Deletion requires `{"version":2}` in the JSON body, locks the current row and checks the version before removal. It deletes only the deal, preserving its client/history; protected related records cause a controlled 409. A repeated deletion returns 404. No invoice data is cascaded or modified.

List example: `GET /api/v1/deals?status=new_lead&currency=EUR&search=website&page=1&page_size=20`. Exact optional status/currency filters reject invalid values with 400. Search uses title, client name and client company. Ordering is newest first (`-created_at`, `-id`); default page size is 20, capped at 100. Invalid/out-of-range pages follow the existing pagination convention. Totals cover all matching records before pagination, grouped by status and currency; they never add different currencies or duplicate a deal for multiple employees.

```json
{
  "count":1,
  "next":null,
  "previous":null,
  "results":["<deal DTO>"],
  "totals":[{"status":"new_lead","currency":"EUR","count":1,"amount":"1500.25"}]
}
```

An empty result has count 0, results [] and totals []. Totals omit empty groups and sort by status code then currency. Each list request recomputes them; under concurrent writes the count, page and totals may reflect successive committed states, so refresh retrieves the latest state. Pagination is deterministic for unchanged data, not a snapshot across requests.

## Deals frontend integration

The authenticated `#/deals` route uses the same session/CSRF client as Clients. It loads every page of the workspace-scoped deal list for the board, keeps the API's status/currency totals separate, and loads every page of workspace clients for the form selector. The server remains responsible for access checks, validation, Decimal arithmetic, and versions. The UI formats amount strings without converting them to JavaScript numbers: `9800.00` displays as `9,800 USD` and opens as `9800` in the edit form, while `9800.50` displays as `9,800.50 USD`. The API and stored values retain two decimal places. There is no workspace or creator input.

New deal creates a backend record. The five-stage board supports handle-based dragging, while the inline detail panel offers a keyboard-accessible status selector and archive outcome. Table shows the same loaded records with client-side sorting and 20-row pages. Search runs on submit; status/currency filters and Refresh request current server data. The client detail's related-deal links open the matching deal panel, and a deal's client link opens the matching client drawer. Displayed deadline and timestamp text uses English month names in the viewer's local time. The create/edit form uses an English month/weekday calendar with 24-hour time controls; it submits an ISO 8601 UTC datetime or null. The Notes tab links to shared client notes; deal-specific notes, creator names, service categories and next-step text are not present in the deal API and are not invented in the live UI.

Edit and status writes send the observed version. A 409 keeps the form draft and offers a separate load of current server values for comparison before the user explicitly discards the draft. A failed drag restores the previous board state and reports the error; the board then refetches authoritative records/totals. Delete requires confirmation and sends the observed version; 409 or other failures leave the deal visible. Successful writes refetch the list. Paid status is a pipeline state, not an invoice payment or revenue event.

## Invoices API

All routes require session authentication and workspace membership. They have no trailing slash. Writes require the session's CSRF token. Foreign or missing invoices and foreign client IDs return 404; the browser cannot set workspace, creator, snapshots, number, totals or timestamps.

| Method | Route | Purpose |
| --- | --- | --- |
| GET, POST | `/api/v1/invoices` | List/search/filter or create a draft |
| GET, PATCH | `/api/v1/invoices/{id}` | Read or edit a draft |
| PATCH | `/api/v1/invoices/{id}/status` | Draft → Sent → Paid |

List results use the same page-number envelope as Clients: `count`, `next`, `previous`, `results`, with page size 20 and a maximum of 100. Ordering is `-created_at`, `-id`. `search` matches invoice number and client name/company; `status` and `currency` are exact filters. An empty workspace returns `results: []`.

Create example:

```http
POST /api/v1/invoices
Content-Type: application/json
X-CSRFToken: <current-token>

{"client":"<workspace-client-uuid>","currency":"EUR","seller":{"name":"Sample Studio","email":"billing@example.test"},"items":[{"description":"Design service","quantity":"2.000","unit_price":"49.9950","tax_rate":"20.0000"}]}
```

The server assigns a workspace-unique sequential number such as `INV-000001`, a Draft status, seller and buyer snapshots, item positions and totals. Its response includes `id`, `invoice_number`, `client`, `created_by`, `currency`, `status`, `issued_at`, `paid_at`, `seller_snapshot`, `buyer_snapshot`, `items`, `subtotal`, `tax_total`, `total_amount`, `created_at` and `updated_at`. Each item includes `id`, `position`, `description`, `quantity`, `unit_price`, `tax_rate`, `line_total` and `tax_amount`. Amounts and rates are JSON strings; for the example, one line has `line_total: "99.99"`, `tax_amount: "20.00"`, and the invoice has `total_amount: "119.99"`.

`quantity` must be greater than zero with at most three fractional digits; `unit_price` is nonnegative with at most four; `tax_rate` is per item from 0 through 100 percent with at most four. At least one and at most 100 items are required. The supported currencies are AUD, CAD, CHF, EUR, GBP, PLN, UAH, USD (two minor digits), JPY (zero), KWD (three) and CLF (four). Other codes are rejected for new writes until their precision is configured. The precision choices follow the [ISO 4217 maintenance agency](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html). There is no currency conversion.

Each line's `quantity × unit_price` is rounded to the currency's minor unit using Decimal `ROUND_HALF_UP`; that rounded line amount × `tax_rate / 100` is rounded the same way. Invoice subtotal and tax total are sums of these rounded line values; total is their sum. Unit prices remain four-decimal strings even for currencies whose final amounts have fewer minor digits. The server rejects amounts beyond its 16-integer-digit storage limit. Browser-supplied calculations are rejected.

`PATCH /api/v1/invoices/{id}` can change a Draft's client, currency, seller details or complete `items` array. Supplying `items` replaces the draft's existing positions transactionally; omitting them retains and recalculates them. Changing the draft's client refreshes its buyer snapshot. Seller details may include name, email, address and tax ID. If seller details are omitted at creation, the current workspace name and creator email are captured. After status changes, snapshots and values cannot be edited. Existing historical invoice values are preserved by migration.

```http
PATCH /api/v1/invoices/{id}/status
Content-Type: application/json
X-CSRFToken: <current-token>

{"status":"sent"}
```

Only Draft → Sent and Sent → Paid are allowed. Sent records `issued_at` but does not email the client; Paid records `paid_at` but does not process a payment. Sent and Paid are immutable, cannot be reopened, and the API has no DELETE route. A disallowed change returns a structured 400 error. Client and InvoiceItem relations use PROTECT, so deleting a client cannot remove an invoice. The visual preview uses its own sample dataset.

`GET /api/v1/invoices/{id}/pdf` returns `application/pdf` with a safe attachment filename based on the server-generated invoice number. The same workspace and authentication checks as invoice detail apply; foreign or missing records return 404. The PDF renders saved seller/buyer snapshots, all line items, tax and totals, status and issue date, with Unicode text and repeated table headings across pages. The live Invoices screen offers Download PDF and browser Print. A PDF failure leaves the saved invoice and any open editor unchanged. Printing and sending status do not email or charge anyone.

## Dashboard analytics

`GET /api/v1/analytics/dashboard?currency=USD&period=month` requires a signed-in workspace member. `currency` defaults to USD and accepts AUD, CAD, CHF, CLF, EUR, GBP, JPY, KWD, PLN, UAH or USD. `period` defaults to `month` and accepts `month` or `quarter`; invalid values return the standard 400 error. The endpoint has no trailing slash.

The response includes `currency`, `period`, inclusive `start` and exclusive `end` ISO timestamps, `pipeline_value`, nullable `win_rate`, nullable `average_deal_size`, `revenue`, `revenue_rows`, `deal_counts`, and up to four `recent_deals`. Monetary KPI and row values are Decimal strings at the selected currency precision; win rate is a percentage string with two decimals. The last 12 calendar months or eight calendar quarters include zero-revenue rows. Boundaries and grouping use the configured Django timezone. `revenue` covers only the displayed window; pipeline, win rate, average and stage counts use all workspace deals in that currency. A missing win-rate denominator or paid-deal count returns `null` for the corresponding KPI.

Pipeline sums new lead, negotiation and in-progress deals. Win rate is paid deals / (paid + archived lost), excluding archived cancelled. Average deal size uses paid deals. Revenue sums paid invoices by `paid_at`; paid deals do not add revenue. No currency conversion occurs. All queries filter the authenticated workspace. The live Dashboard requests this endpoint again when currency or period changes; the design preview remains separate sample data.

## Visual preview boundary

`GET /api/v1/workspace/preview` requires a signed-in workspace member. It returns that workspace's separate `PreviewDataset.payload` JSON or 404 when no dataset exists. The frontend `/preview` route loads this snapshot after sign-in. Its Kanban/table/details, client list, dashboard, invoice form/document and settings use the snapshot in React state; search, filters and local forms never write business or preview records. Reload discards sample mutations. PDF/print and preview drag-and-drop remain disabled. Production invoice calculations and revenue aggregation are not implemented by this preview; use the authenticated `#/deals` route for saved deals.
