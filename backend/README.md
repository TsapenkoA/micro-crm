# Backend

See the [root README](../README.md) for installation, database setup and checks, and [SECURITY.md](SECURITY.md) for encryption, file scanning and recovery.

## Structure

- `crm/models.py`, `crm/apps.py`: model discovery and original application labels.
- `crm/auth`, `workspaces`, `clients`, `deals`, `tasks`, `invoices`, `analytics`, `activity`, `operations`: feature views, serializers and business services.
- `crm/api`: session/workspace permissions, pagination, strict input validation, errors and response policy.
- `crm/services`: shared financial calculations, ECB rates, PDF rendering, upload scanning and data encryption.
- `crm/management/commands`: maintenance commands; `crm/migrations`: preserved histories by app label.
- `config`: settings and URL routes; `tests`: PostgreSQL API and business-rule tests.

Do not move models between application labels or reset migration history. Before upgrading existing data, stop writes, back up and verify restoration. Ownership migrations preserve IDs and relationships and reject inconsistent ownership; the original ownership migration requires backup restoration to undo.

## API

Routes below start with `/api/v1` and have no trailing slash except OAuth callbacks. Business endpoints require a session and workspace membership; platform operations endpoints explicitly require an active platform superuser. Foreign records return 404. Writes require the CSRF cookie and `X-CSRFToken`; login rotates the token. Errors retain `{error: {code, details}}`. Handled API exceptions also include `reason`, distinguishing `version_conflict` from `protected`; `code` remains the HTTP status. All API responses are private and non-cacheable.

These are the implemented contracts, not assumptions from generic REST examples: browser requests use sessions and CSRF rather than bearer tokens; draft edits use `PATCH`; and invoice status, payments, delivery and due-date corrections have separate action endpoints. Refer to the route and contract tables below when updating clients.

| Routes | Methods and purpose |
| --- | --- |
| /health | GET: database availability; 503 when unavailable |
| /auth/csrf, /auth/me | GET: CSRF token or current account/workspace |
| /workspace/operations | GET: platform-administrator-only exchange-rate, restore-test and email configuration status; no credentials or archive paths |
| /auth/login, /auth/logout | POST: establish or end a session |
| /auth/sign-up | POST: username, email, password, password_confirm; returns 202 and emails a verification link |
| /auth/resend-verification | POST: email; rotates the link for a pending registration, with a neutral 202 response |
| /auth/verify-email | POST: token and original signup password; creates the account and workspace, then opens a session |
| /auth/forgot-password, /auth/reset-password | POST: request a reset or submit uid, token and matching passwords |
| /auth/profile | PATCH: username only |
| /auth/email-change, /auth/email-change/confirm | POST: request or confirm an email change |
| /auth/avatar | GET/POST/DELETE: current user's profile photo |
| /auth/sessions/revoke-others | POST: invalidate this user's other sessions after recent authentication; keep the current session |
| /auth/reporting-currency | PATCH: personal reporting currency (EUR, USD, GBP, PLN, AUD, CAD, CHF or JPY) |
| /auth/password, /auth/reauthenticate | POST: change password or confirm identity |
| /auth/providers, /auth/methods | GET: provider configuration and connected methods |
| /auth/providers/<provider> | DELETE: disconnect a provider after recent authentication |
| /auth/oauth/<provider>/start | POST: start provider login or connection |
| /auth/oauth/<provider>/callback/ | GET: provider callback; trailing slash required |
| /workspace/counts, /workspace/preview | GET: workspace counts or isolated design-preview data |
| /workspace/settings | GET: name, IANA time zone and members; PATCH: workspace name or owner-managed time zone |
| /workspace/members | POST: owner sends a request; recipient consent is required |
| /workspace/join-requests/<id> | POST: recipient accepts or declines after recent authentication |
| /workspace/members/<user_id> | DELETE: owner removes a member after recent authentication |
| /workspace/bank-details | GET/PUT: owner-only seller bank details after recent authentication |
| /workspace/seller-details | GET/PUT: owner-only default seller profile after recent authentication |
| /clients | GET/POST: search/paginate or create a client |
| /clients/<id> | GET/PUT/PATCH/DELETE: client details and changes |
| /clients/<id>/notes | GET/POST: shared plain-text notes |
| /clients/<id>/notes/<note_id> | DELETE: own note only |
| /clients/<id>/links | GET/POST: shared http/https links |
| /clients/<id>/links/<link_id> | GET/PATCH/DELETE: edit or remove a saved link |
| /clients/<id>/contacts | GET/POST: primary and additional client contacts |
| /clients/<id>/contacts/<contact_id> | GET/PATCH/DELETE: edit a contact or remove a non-primary contact |
| /clients/<id>/invoices | GET: paginated invoices for this client |
| /clients/<id>/attachments | GET/POST: list or upload private client files |
| /clients/<id>/attachments/<attachment_id> | GET/DELETE: download or remove a private file |
| /deals | GET/POST: filtered deals or create a deal |
| /deals/<id> | GET/PUT/PATCH/DELETE: deal details and changes |
| /deals/<id>/status | PATCH: status/outcome change |
| /deals/<id>/notes | GET/POST: paginated notes for a deal, also visible in its client record |
| /tasks | GET: paginated workspace tasks; POST: create an open task |
| /tasks/counts | GET: filtered workspace counts for My tasks, Team, Overdue, Upcoming and Done |
| /tasks/<id> | GET/PATCH/DELETE: view, update or remove a workspace task |
| /activity | GET: paginated workspace activity; optional entity_type, entity_id, actor, date_from and date_to filters |
| /operations/overview | GET: current user's due tasks and shared invoice/deal deadlines; page and undated_page select 20-record pages |
| /operations/invoice-deliveries | GET: unresolved email attempts; platform superuser only |
| /operations/invoice-deliveries/<id>/resolve | POST: resolve an attempt as accepted or failed with an audit reason; platform superuser only |
| /invoices | GET/POST: search/filter invoices or create a draft |
| /invoices/summary | GET: original-currency totals across matching workspace records |
| /invoices/<id> | GET/PATCH: details or draft changes |
| /invoices/<id>/status | PATCH: issue without email or record the full outstanding balance |
| /invoices/<id>/payments | POST: record a received partial or full payment |
| /invoices/<id>/payments/<payment_id>/void | POST: reverse a non-legacy payment with a reason |
| /invoices/<id>/due-date-corrections | POST: correct an issued due date with a reason |
| /invoices/<id>/cancel | POST: cancel an unpaid draft or sent invoice with a reason |
| /invoices/<id>/send | POST: issue and email the PDF, or retry a failed email |
| /invoices/<id>/reminder | GET: review reminder; POST: send after explicit confirmation |
| /invoices/<id>/pdf | GET: invoice PDF |
| /analytics/dashboard | GET: currency and month/quarter analytics |

## Contracts

- Email confirmation requires `POST /auth/verify-email` with `token` and the original signup `password`. An active pending signup cannot be overwritten; use resend verification instead. Changing an account email sends a security notification to the previous address after commit.
- Login and password-recovery limits combine the identifier and client IP, with a higher IP-wide quota. Successful login resets its identifier/IP counter. Forwarded IP headers are ignored unless both `TRUSTED_PROXY_COUNT` and `TRUSTED_PROXY_IPS` are configured for a trusted proxy chain; the proxy must replace untrusted forwarded headers. Invoice sends and reminders share quotas of 20 requests per user and 100 per workspace per hour.
- A deal with linked invoices, tasks or notes cannot be moved to another client. Client changes lock the deal while checking its relationships; version checks remain mandatory.
- Definite SMTP rejections are recorded as failed and can be retried. Timeouts and other uncertain results remain unknown and block resend until reviewed. Issuing an invoice and delivering email are separate events: a failed delivery does not revert an issued document. Logs contain delivery IDs and error classes, without recipient addresses, credentials or raw SMTP responses.
- One membership per user. Registration provisions an independent workspace only after email confirmation. Matching email domains never join a company. Owner requests expire after seven days; recipients must explicitly accept after confirming identity. Acceptance rechecks ownership and an empty personal workspace. Removal retains company records, creates a personal workspace and invalidates the former member's sessions. Any member can rename the workspace.
- Clients sort by `-created_at`, `-id`, support name/company/email search and pagination. Details include related workspace deals. Primary contacts mirror client name/email/phone; changing the primary contact leaves issued invoice snapshots intact. Related history and financial records block deletion with 409. Notes are plain text with server-supplied author/time; only the author can delete a note. Links accept HTTP/HTTPS only. Attachments are private, signature-checked and scanned, at most 5 MB each and 50 per client.
- Deals use decimal string amounts, a timezone-qualified deadline, five stages and archived outcomes `none`, `lost`, `cancelled`, `won`. Archiving a paid deal preserves its payment timestamp and FX date; older archived rows are not reclassified. Updates/deletion require the observed integer `version`; conflicts return 409 without partial changes. Description is independent of shared notes. List filters: `search`, `status`, `currency`, `page`, `page_size`, `ordering=newest|title|client|deadline`. Totals cover the complete matching selection.
- Tasks belong to a client and optionally its deal. Assignees must be active workspace members; omission defaults to the current user. Client/deal cannot change after creation. Completion sets `completed_at`; reopening clears it. List filters include `mine=1`, `status=open|done`, `due=overdue|upcoming`, `search`, `client`, `deal` and pagination. Member removal leaves tasks unassigned.
- Invoices calculate totals server-side with currency-specific precision. Only drafts can change client, seller, currency or items. Optional `deal` must belong to the same client/workspace; linked deals cannot move clients or be deleted. New drafts copy seller/payer details; saved snapshots do not change when settings change. Issuing records a fixed `issued_on` business date and defaults a missing due date to 30 days. Existing undated sent invoices require an explicit due-date correction with a reason.
- Confirmed partial/full payments are recorded manually, never collected online. Overpayments, future dates and excess precision are rejected. Reversal requires a reason and retains history; legacy backfilled payments cannot be reversed. Cancellation requires a reason and no active payments. Deal stages remain independent of invoice payments.
- Invoice lists omit bank snapshots, items, payments and delivery details; open the detail endpoint for the full document. `search`, `status`, `currency`, `overdue=true` and pagination filter rows. Summary totals keep original currencies separate and cover all pages. PDF and HTML use the saved document data.
- Email and reminders require explicit confirmation and SMTP. `accepted` means mail-server acceptance, not inbox delivery. Failed attempts allow retry; pending/unknown outcomes block it. Reminders require an overdue balance and allow one accepted send per seven days. No automatic reminder scheduler is configured.
- Operations returns assigned open tasks and shared invoice/deal deadlines, overdue or due within seven days. `page` and `undated_page` select 20-record pages. Activity records successful changes transactionally, with allowlisted metadata; note bodies, file contents, bank values and payment references are omitted. It is not a tamper-proof audit log.
- A workspace owner may set an IANA `time_zone` in Workspace settings; new workspaces default to `UTC`. Business dates and calendar boundaries use that zone per request; stored instants remain UTC and issued invoice dates are fixed. Platform superusers can review unresolved email outcomes in Operations; marking an attempt failed permits retry and can cause duplicate delivery if provider acceptance was misjudged.

## Authentication and email

Set provider credentials in the ignored root `.env`. Local callbacks through Vite:

| Provider | Callback |
| --- | --- |
| Google | `http://127.0.0.1:5173/api/v1/auth/oauth/google/callback/` |
| GitHub | `http://127.0.0.1:5173/api/v1/auth/oauth/github/callback/` |
| Microsoft | `http://127.0.0.1:5173/api/v1/auth/oauth/microsoft/callback/` |

Microsoft defaults to `common`; the provider registration must allow the intended account types. New OAuth accounts require provider-verified email. State/PKCE protect callbacks; accounts are never merged by email. Connect/disconnect requires recent authentication and cannot remove the last usable login method. Provider tokens are not retained.

Signup links expire after 24 hours; reset tokens after one hour. Tokens are one-use; reset invalidates old sessions. Email change requires recent authentication and confirmation by the same signed-in account before replacing the old address. Public registration/reset responses avoid account enumeration. Run `clear_auth_attempts` and `clear_expired_signups` periodically.

SMTP configuration uses `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL`. Check actual delivery with `uv run python manage.py check_email_delivery --to <your-address>` and confirm receipt. The console backend does not deliver invoice mail. Production settings require HTTPS and SMTP; infrastructure remains environment-specific.

## Rates and maintenance

Supported reporting/invoice currencies: USD, EUR, GBP, PLN, AUD, CAD, CHF, JPY. Deals may accept other ISO currencies except CLF, UAH and KWD, but analytics cannot convert unsupported currencies. ECB rates are immutable reference rates for reporting, not settlement. Active pipeline uses a common date at most four days old; paid records keep a fixed historical rate date. Missing rates hide affected totals rather than returning partial sums.

```powershell
uv run python manage.py sync_fx_rates --since <YYYY-MM-DD>
uv run python manage.py snapshot_fx_rates
uv run python manage.py check_fx_rates
uv run python manage.py refresh_fx_rates
```

On Windows, register a daily Task Scheduler job from the repository root to run after ECB publication:

```powershell
$backend = (Resolve-Path .\backend).Path
$uv = (Get-Command uv).Source
$action = New-ScheduledTaskAction -Execute $uv -Argument "run python manage.py refresh_fx_rates" -WorkingDirectory $backend
$trigger = New-ScheduledTaskTrigger -Daily -At "5:00 PM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "MicroFlow ECB FX Refresh" -Action $action -Trigger $trigger -Settings $settings -Principal $principal
```

The task runs as the current Windows user while signed in; `StartWhenAvailable` catches up after a missed run. `refresh_fx_rates` imports rates, fills missing paid-record rate dates and checks freshness; failure exits nonzero. `FX_ALERT_EMAIL` plus SMTP enables operator failure notices. On a hosted deployment, configure the equivalent daily scheduler there instead.

For trusted administrator assignment, create a user with `createsuperuser` or Django's `create_user`, then run `assign_workspace <username> <workspace-uuid>`. This command bypasses the user consent flow; restrict it to trusted operators. It refuses to move business data.

For backups, use `backup_database --output <absolute-new-archive-path> --pg-bin <PostgreSQL-bin-directory>`. Archives must be outside the repository; existing paths are refused. `--verify-restore` restores into a unique temporary database, compares business-table counts and removes only that database. If the application role lacks CREATEDB, supply `--maintenance-user <role>` with `PGMAINTENANCEPASSWORD` only in that process environment. Keep protected off-device copies and the separate encryption key. Scheduling and storage are external responsibilities.

For an unknown invoice email outcome, platform superusers can investigate provider acceptance and resolve the attempt in Operations. The API records the operator and reason; marking it failed permits retry and may produce a duplicate if acceptance was misjudged. The audited command remains available: `resolve_invoice_delivery <attempt-uuid> --outcome accepted|failed --operator <superuser> --reason <evidence>`.

To populate a development workspace with clearly marked fictional records, enable `DEBUG` and run `uv run --directory backend python manage.py seed_demo_data <workspace-uuid> --confirm`. The command refuses production settings, requires explicit confirmation, uses `.example.test` addresses, never sends email, and refuses to overwrite existing demo markers.

Invoice PDFs use the bundled DejaVu Sans fonts in `assets/fonts`; their redistribution license is included there. System font installation is not required.
