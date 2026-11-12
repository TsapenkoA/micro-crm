# Backend

Run setup and verification commands from the [root README](../README.md).

## Code

All application code lives in crm/. Files are grouped by responsibility:

```text
crm/
    __init__.py
    apps.py
    models.py
    api/
        health.py
        pagination.py
        permissions.py
        errors.py
    auth/
        views.py
        verification.py
        avatar.py
        serializers.py
        security.py
        oauth.py
        adapters.py
        signals.py
    workspaces/
        views.py
        serializers.py
    clients/
        views.py
        serializers.py
    deals/
        views.py
        serializers.py
    invoices/
        views.py
        serializers.py
        services.py
    analytics/
        views.py
        serializers.py
        services.py
    services/
        calculations.py
        fx.py
        pdf.py
    management/commands/
    migrations/
```

models.py and apps.py stay at the application root for Django's model discovery and application configuration. Feature packages keep their views and serializers together. api/ contains shared HTTP helpers; services/ contains shared calculations, exchange rates and PDF rendering.

A request enters through config/urls.py and reaches the relevant feature's views.py. Its serializers.py validates input. Workspace access is checked in api/permissions.py. Invoice views call invoices/services.py and the shared services/ package; analytics views call analytics/services.py. Routes and response contracts remain in config/urls.py and the feature views.

management/commands/ contains trusted local maintenance commands. migrations/ preserves the existing histories grouped by their original application labels.

config/ holds settings and URL routes. tests/ contains six suites: authentication, clients/history, deals, invoices, dashboard and workspaces/migrations.

The historical accounts, clients, deals and invoices labels are registered in crm/apps.py and mapped with MIGRATION_MODULES. Models retain those labels so table names, content types, permissions and applied migration records stay compatible. Keep them when adding models or migrations. The old migration histories must remain intact; moving source code does not require a database reset.

## API

All routes start with /api/v1. Business endpoints require a session and workspace membership, including for administrators. Foreign workspace records return 404. Unsafe requests require the csrftoken cookie and X-CSRFToken header. GET /auth/csrf returns a csrfToken; login rotates it. Errors use an error object with code and details.

| Routes | Methods and purpose |
| --- | --- |
| /health | GET: database availability; 503 when unavailable |
| /auth/csrf, /auth/me | GET: CSRF token or current account/workspace |
| /workspace/operations | GET: owner-only exchange-rate, restore-test and email configuration status; no credentials or archive paths |
| /auth/login, /auth/logout | POST: establish or end a session |
| /auth/sign-up | POST: username, email, password, password_confirm; returns 202 and emails a verification link |
| /auth/resend-verification | POST: email; rotates the link for a pending registration, with a neutral 202 response |
| /auth/verify-email | POST: token; creates the account and workspace, then opens a session |
| /auth/forgot-password, /auth/reset-password | POST: request a reset or submit uid, token and matching passwords |
| /auth/profile | PATCH: username only |
| /auth/avatar | GET/POST/DELETE: current user's profile photo |
| /auth/reporting-currency | PATCH: personal reporting currency (EUR, USD, GBP, PLN, AUD, CAD, CHF or JPY) |
| /auth/password, /auth/reauthenticate | POST: change password or confirm identity |
| /auth/providers, /auth/methods | GET: provider configuration and connected methods |
| /auth/providers/<provider> | DELETE: disconnect a provider after recent authentication |
| /auth/oauth/<provider>/start | POST: start provider login or connection |
| /auth/oauth/<provider>/callback/ | GET: provider callback; trailing slash required |
| /workspace/counts, /workspace/preview | GET: workspace counts or isolated design-preview data |
| /workspace/settings | GET: name and members; PATCH: shared workspace name |
| /workspace/members | POST: workspace owner adds an existing account |
| /workspace/members/<user_id> | DELETE: owner removes a member after recent authentication |
| /workspace/bank-details | GET/PUT: owner-only seller bank details after recent authentication |
| /workspace/seller-details | GET/PUT: owner-only default seller profile after recent authentication |
| /clients | GET/POST: search/paginate or create a client |
| /clients/<id> | GET/PUT/PATCH/DELETE: client details and changes |
| /clients/<id>/notes | GET/POST: shared plain-text notes |
| /clients/<id>/notes/<note_id> | DELETE: own note only |
| /clients/<id>/links | GET/POST: shared http/https links |
| /deals | GET/POST: filtered deals or create a deal |
| /deals/<id> | GET/PUT/PATCH/DELETE: deal details and changes |
| /deals/<id>/status | PATCH: status/outcome change |
| /invoices | GET/POST: search/filter invoices or create a draft |
| /invoices/<id> | GET/PATCH: details or draft changes |
| /invoices/<id>/status | PATCH: issue without email or record the full outstanding balance |
| /invoices/<id>/payments | POST: record a received partial or full payment |
| /invoices/<id>/cancel | POST: cancel an unpaid draft or sent invoice with a reason |
| /invoices/<id>/send | POST: issue and email the PDF, or retry a failed email |
| /invoices/<id>/reminder | GET: review reminder; POST: send after explicit confirmation |
| /invoices/<id>/pdf | GET: invoice PDF |
| /analytics/dashboard | GET: currency and month/quarter analytics |

Invoice creation and draft updates accept an optional `deal` UUID (or `null`). The deal must belong to the invoice's client and workspace. Invoice responses include `deal`, which is `null` for existing unlinked invoices. `GET /invoices?deal=<uuid>` returns only invoices linked to that deal within the current workspace. A deal may have multiple invoices. A linked deal cannot be moved to another client or deleted until its invoices are unlinked; recording a payment never changes the deal status or value.

Client input accepts name, company, email, phone and optional `bank_details`. The server supplies workspace, creator, IDs and timestamps. Bank details are returned on client detail, not in the list. Related history or financial records protect clients from deletion (409).

Deals use title, client, amount, currency and an optional timezone-qualified deadline. Statuses are new_lead, negotiation, in_progress, paid and archived; archived outcomes are none, lost or cancelled. Updates, status changes and deletion require the observed integer version. A stale version returns 409. Send decimal amounts as strings.

Invoices accept client, currency, optional deal, due_date, payment_terms, seller details and items (description, quantity, unit_price, tax_rate). The backend assigns numbers, calculates currency-specific totals and stores buyer/seller snapshots. Workspace bank details are copied into the seller snapshot; client bank details are copied into the buyer snapshot. Both appear in the invoice view and PDF. Later changes to saved bank details do not alter existing snapshots. Only drafts can be edited. Issuing a draft sets its issue time and defaults to a 30-day due date if none was entered. Issued documents retain their original recipient, amount, terms and PDF; cancellation preserves the document and records a reason. Existing invoices without a due date remain without one until edited as drafts.

The workspace owner can save a default seller name, business email, phone, address and tax ID through `GET/PUT /workspace/seller-details` after recent authentication. The endpoint returns `Cache-Control: no-store` and accepts a full replacement object with required name and valid email. For example: `{"name":"Example Agency Ltd","email":"billing@example.test","phone":"+1 202 555 0100","address":"12 Main Street, London","tax_id":"GB123456789"}`. A new invoice without an explicit `seller` copies this profile into its seller snapshot; if the profile is empty, it uses the workspace name and creator email. An explicit `seller` remains available for a draft-specific override. Members cannot read or change the saved profile in Settings, but can view seller details in workspace invoices and PDFs under the existing invoice access rules. Profile changes do not rewrite earlier draft or issued snapshots, amounts or PDFs. Saved bank details remain a separate owner-only setting and are copied into each new snapshot.

`GET /invoices?overdue=true` returns sent invoices whose due date has passed. Responses include `overdue`, `paid_amount`, `balance_due`, `payments` and `deliveries`. Record each confirmed payment with `POST /invoices/<id>/payments`, for example `{"amount":"40.00","received_on":"2026-11-12","reference":"Bank transfer"}`. A partial payment leaves the invoice Sent; the exact final payment changes it to Paid. Future dates, excess amounts and excess decimal precision are rejected. Dashboard revenue now sums recorded payments by receipt date and fixed ECB rate date, including partial payments. A data migration adds one marked legacy payment for each previously paid invoice with a positive total, preserving its amount and rate date. This is manual accounting, not an online charge or bank reconciliation.

`POST /invoices/<id>/send` emails the PDF to the email stored in the buyer snapshot and logs the mail server's accepted or failed result and attempt time. It checks email syntax, but does not verify mailbox ownership or guarantee inbox delivery. A successful send cannot be repeated; a failed send can be retried. Email requires a configured SMTP backend; the local console backend returns 503 without claiming delivery. `GET /invoices/<id>/reminder` previews the fixed reminder text and send eligibility. The user confirms it with POST; reminders require an overdue sent invoice with a balance and are limited to one accepted reminder every seven days. No automatic reminders or schedule are configured. Both email actions require a workspace member and CSRF. Cancelling requires a reason and is refused once any payment exists. For an already emailed invoice, notify the recipient of cancellation separately.

Bank details are optional. Only the workspace owner can read or replace saved seller details through `/workspace/bank-details`, and both requests require recent authentication. Responses containing saved seller details use `Cache-Control: no-store`. `bank_details` in a client create/update payload replaces that client's payer details. Accepted fields are `account_holder`, `bank_name`, `iban`, `bic`, `account_number`, `routing_number` and `payment_instructions`. IBAN and BIC receive format checks, not bank-account ownership verification. Invoice snapshots and PDFs remain visible to workspace members and include the payment details copied when the invoice was created. Existing invoices retain their original snapshots. Example:

```json
{"account_holder":"Example Studio","bank_name":"Example Bank","iban":"DE89370400440532013000","bic":"COBADEFF"}
```

## Exchange rates and analytics

`sync_fx_rates` imports daily EUR-based reference rates from the ECB Data Portal over HTTPS. Stored rates have a date, source and retrieval time. Supported invoice and reporting currencies are EUR, USD, GBP, PLN, AUD, CAD, CHF and JPY. CLF, UAH and KWD are unavailable for new deals and invoices. A Deal may accept other ISO codes without an ECB rate; an affected Dashboard total is unavailable rather than incomplete. These reference rates are for reporting, not bank settlement.

```powershell
uv run python manage.py sync_fx_rates --since 2025-12-01 --until 2026-11-09
uv run python manage.py snapshot_fx_rates
uv run python manage.py check_fx_rates
```

For routine updates, schedule `uv run python manage.py refresh_fx_rates` daily after ECB publication in the deployment environment. It runs import, paid-record backfill and health check in sequence. A failed step exits nonzero. Set `FX_ALERT_EMAIL` and configure SMTP to send a generic failure notice to the operator; the job log keeps the diagnostic details. The local console email backend does not deliver alerts. `sync_fx_rates` records each attempt, its result and the latest imported date in `FxSyncRun`. `check_fx_rates` also exits nonzero when the latest attempt failed, the last successful run is over two days old, a complete seven-currency rate date is over four days old, or a paid record has no fixed rate date. Holidays may require operator review of the freshness threshold. The command does not invent missing rates or change document amounts. The application does not register a Windows task or configure an external scheduler.

Omit `--until` for current imports. Repeated imports leave identical stored rates alone and refuse changed historical values. For an old paid record with missing rates, import the relevant historical date range and run `snapshot_fx_rates`, then `check_fx_rates`. A rate that the ECB does not publish for a required date must be investigated; do not edit an existing stored rate. Back up the database before migrations or historical backfill. `snapshot_fx_rates` only fills missing rate dates for existing paid records, without changing their amounts.

For PostgreSQL backups, create a restricted directory outside the repository and run `uv run python manage.py backup_database --output <absolute-new-archive-path> --pg-bin <PostgreSQL-bin-directory>`. The command refuses existing archive paths and locations inside the project, uses the configured database credentials without passing the password as an argument, and reads the entire archive with `pg_restore`. Add `--verify-restore` to restore into a uniquely named temporary database, compare counts for core business tables and remove only that temporary database. A successful restore test records its time and archive size in `BackupCheck`, without storing the archive path or content. This requires a PostgreSQL role with `CREATEDB`. Pass it as `--maintenance-user <role>` and set `PGMAINTENANCEPASSWORD` only in the verification process environment; do not store a privileged password in the project or the application service environment. The temporary database belongs to the application role so restore uses its ordinary credentials. The command never restores over the live database. Set `BACKUP_DIRECTORY` to the restricted directory to make the latest `microflow-*.dump` archive timestamp available to the owner-only API; the API does not expose its path. Keep an additional copy in secure off-device storage and periodically test restore. Schedule the backup separately from the FX job. A local archive was restored and its record counts matched on November 11, 2026; that temporary database and archive were then removed. A new archive was stored in a restricted local profile directory and read successfully. No persistent backup schedule or off-device storage is configured.

Active pipeline uses the latest common rate date, at most four days old. Paid deals and invoices use a fixed available rate date at or before their payment date. A later import does not replace a fixed date or an existing rate. The Dashboard response includes the rate source, dates and missing currencies in `fx`; an affected KPI or revenue period is `null` if a required rate is missing. Reporting preference is saved per workspace member and exposed in `/auth/me`. Original invoice amounts and currency never change during reporting conversion. The Invoices currency selector filters both the original-currency summary and the table. Deals displays currency totals when a currency filter is selected; the all-currencies view shows deal counts and original amounts without combining currencies.

## Workspaces and maintenance

Normal user creation provisions a personal workspace. Each user has one membership; members share their company's records. Public signup keeps a temporary password hash and one-time token digest, but creates no user or workspace until email verification. The link expires after 24 hours; requesting a new link invalidates the old one. Existing accounts remain usable without a migration of their email status. Public signup and matching email domains never join an existing company. Member changes require an authenticated workspace owner.

The earliest member of an existing workspace becomes its owner when the owner migration runs; new personal workspaces belong to their creator. In Settings, the owner can add an existing account by username after a recent sign-in. The account must be the only member and owner of an empty personal workspace. An account with clients, deals or invoices cannot be moved in. The owner can also remove another member after a recent identity check and CSRF-protected confirmation. Removal creates an empty personal workspace for that account and deletes its active database sessions; subsequent requests resolve the new membership, so old company records and PDFs are inaccessible. Historical creator, note-author and payment-recorder references remain with the company and do not require the former employee to retain membership. The owner cannot remove themselves. There is no email invitation flow. Any current member can rename the shared workspace. Only its owner can view or edit saved seller bank details. The member directory includes usernames, full names and email addresses of members in the current workspace.

Profile photos are private account data. The avatar endpoint accepts JPEG, PNG or WebP uploads up to 2 MB and 4096 pixels per side, verifies the image, strips its metadata and stores a 256-pixel JPEG in PostgreSQL. Only the signed-in user can fetch or delete their photo. A new avatar URL is returned with account data after upload.

Create an employee using the Django shell, then assign an existing workspace:

```python
from getpass import getpass
from django.contrib.auth import get_user_model
get_user_model().objects.create_user(username="teammate", password=getpass("Password: "))
```

```powershell
uv run python manage.py shell -c "from crm.models import WorkspaceMembership; print(WorkspaceMembership.objects.get(user__username='admin').workspace_id)"
uv run python manage.py assign_workspace teammate <workspace-uuid>
uv run python manage.py clear_auth_attempts
```

Replace the workspace placeholder with the printed UUID. Assignment is idempotent and refuses to move a user whose current workspace contains business records. Bulk imports and raw fixtures bypass automatic provisioning and need explicit memberships. Model validation is bypassed by direct SQL and bulk updates; never use those paths to change ownership.

When upgrading legacy personal-ownership data, stop application processes, take a backup and apply the preserved migrations. They retain IDs, amounts and relationships and create separate workspaces without grouping users. Inconsistent ownership stops migration for review. The ownership data migration is irreversible; restore a backup for recovery.

## Authentication configuration

Passwords use Django hashing/validation. Verification links expire after 24 hours and cannot be reused; pending registrations store no plaintext passwords or tokens. Reset tokens expire after one hour and cannot be reused; reset invalidates old sessions. Signup and resend responses do not reveal whether an email is already registered. Local email is printed in the backend terminal.

Set provider credentials in the root .env and restart Django. Missing credentials disable the provider. Register Web OAuth applications with these exact local callback URLs:

| Provider | Variables | Callback |
| --- | --- | --- |
| Google | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | http://127.0.0.1:5173/api/v1/auth/oauth/google/callback/ |
| GitHub | GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET | http://127.0.0.1:5173/api/v1/auth/oauth/github/callback/ |
| Microsoft | MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT | http://127.0.0.1:5173/api/v1/auth/oauth/microsoft/callback/ |

Microsoft uses the common tenant by default; registration must allow the corresponding account types. Google testing mode requires permitted test users. New provider accounts require a verified email from the provider. Provider identities use state/PKCE and are never automatically merged by email. Existing users must sign in and explicitly connect a provider. Connection/disconnection requires authentication within five minutes or password confirmation and cannot remove the final usable method. Provider tokens are not retained.

PostgreSQL-backed rate limits cover login, signup, verification/resend, reset and provider/security actions. Periodically run `clear_auth_attempts` and `clear_expired_signups` to remove old counters and unverified requests. Proxy trust and network limits depend on deployment.

Production uses config.settings.production, an HTTPS FRONTEND_URL, authenticated SMTP EMAIL_BACKEND and EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, EMAIL_USE_TLS and DEFAULT_FROM_EMAIL. Startup rejects missing SMTP credentials or the local placeholder sender. After configuring SMTP, run `uv run python manage.py check_email_delivery --to operator@example.com` and confirm the message arrives in that inbox. This command refuses the console email backend; successful submission alone does not prove delivery. Production enables HTTPS redirects and Secure cookies. Hosting, backups, live provider consent and SMTP delivery require environment-specific verification.
