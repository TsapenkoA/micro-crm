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
| /auth/login, /auth/logout | POST: establish or end a session |
| /auth/sign-up | POST: username, email, password, password_confirm |
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
| /workspace/bank-details | GET/PUT: owner-only seller bank details after recent authentication |
| /clients | GET/POST: search/paginate or create a client |
| /clients/<id> | GET/PUT/PATCH/DELETE: client details and changes |
| /clients/<id>/notes | GET/POST: shared plain-text notes |
| /clients/<id>/notes/<note_id> | DELETE: own note only |
| /clients/<id>/links | GET/POST: shared http/https links |
| /deals | GET/POST: filtered deals or create a deal |
| /deals/<id> | GET/PUT/PATCH/DELETE: deal details and changes |
| /deals/<id>/status | PATCH: status/outcome change |
| /invoices | GET/POST: search/filter invoices or create a draft |
| /invoices/<id> | GET/PUT/PATCH: details or draft changes |
| /invoices/<id>/status | PATCH: mark sent or paid |
| /invoices/<id>/pdf | GET: invoice PDF |
| /analytics/dashboard | GET: currency and month/quarter analytics |

Client input accepts name, company, email, phone and optional `bank_details`. The server supplies workspace, creator, IDs and timestamps. Bank details are returned on client detail, not in the list. Related history or financial records protect clients from deletion (409).

Deals use title, client, amount, currency and an optional timezone-qualified deadline. Statuses are new_lead, negotiation, in_progress, paid and archived; archived outcomes are none, lost or cancelled. Updates, status changes and deletion require the observed integer version. A stale version returns 409. Send decimal amounts as strings.

Invoices accept client, currency, optional seller details and items (description, quantity, unit_price, tax_rate). The backend assigns numbers, calculates currency-specific totals and stores buyer/seller snapshots. Workspace bank details are copied into the seller snapshot; client bank details are copied into the buyer snapshot. Both appear in the invoice view and PDF. Later changes to saved bank details do not alter existing snapshots. Only drafts can be edited. Sent/paid transitions preserve snapshots; payment status is manual, with no payment-provider integration. Dashboard revenue comes from paid invoices; deal metrics come from deals. Invoice lists and PDF retain original currencies. Dashboard converts supported currencies into the selected reporting currency.

Bank details are optional. Only the workspace owner can read or replace saved seller details through `/workspace/bank-details`, and both requests require recent authentication. Responses containing saved seller details use `Cache-Control: no-store`. `bank_details` in a client create/update payload replaces that client's payer details. Accepted fields are `account_holder`, `bank_name`, `iban`, `bic`, `account_number`, `routing_number` and `payment_instructions`. IBAN and BIC receive format checks, not bank-account ownership verification. Invoice snapshots and PDFs remain visible to workspace members and include the payment details copied when the invoice was created. Existing invoices retain their original snapshots. Example:

```json
{"account_holder":"Example Studio","bank_name":"Example Bank","iban":"DE89370400440532013000","bic":"COBADEFF"}
```

## Exchange rates and analytics

`sync_fx_rates` imports daily EUR-based reference rates from the ECB Data Portal over HTTPS. Stored rates have a date, source and retrieval time. Supported invoice and reporting currencies are EUR, USD, GBP, PLN, AUD, CAD, CHF and JPY. CLF, UAH and KWD are unavailable for new deals and invoices. A Deal may accept other ISO codes without an ECB rate; an affected Dashboard total is unavailable rather than incomplete. These reference rates are for reporting, not bank settlement.

```powershell
uv run python manage.py sync_fx_rates --since 2025-12-01 --until 2026-11-09
uv run python manage.py snapshot_fx_rates
```

Omit `--until` for current imports and schedule both commands daily after ECB publication in the deployment environment. Repeated imports leave identical stored rates alone and refuse changed historical values. Back up the database before migrations or historical backfill. `snapshot_fx_rates` only fills missing rate dates for existing paid records, without changing their amounts.

Active pipeline uses the latest common rate date, at most four days old. Paid deals and invoices use a fixed available rate date at or before their payment date. A later import does not replace a fixed date or an existing rate. The Dashboard response includes the rate source, dates and missing currencies in `fx`; an affected KPI or revenue period is `null` if a required rate is missing. Reporting preference is saved per workspace member and exposed in `/auth/me`. Original invoice amounts and currency never change during reporting conversion. The Invoices currency selector filters both the original-currency summary and the table. Deals displays currency totals when a currency filter is selected; the all-currencies view shows deal counts and original amounts without combining currencies.

## Workspaces and maintenance

Normal user creation provisions a personal workspace. Each user has one membership; members share their company's records. Public signup and matching email domains never join an existing company. Member changes require an authenticated workspace owner.

The earliest member of an existing workspace becomes its owner when the owner migration runs; new personal workspaces belong to their creator. In Settings, the owner can add an existing account by username after a recent sign-in. The account must be the only member and owner of an empty personal workspace. An account with clients, deals or invoices cannot be moved. This action does not merge business records or create an account, and there is no email invitation or member-removal flow. Any current member can rename the shared workspace. Only its owner can view or edit saved seller bank details. The member directory includes usernames, full names and email addresses of members in the current workspace.

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

Passwords use Django hashing/validation. Reset tokens expire after one hour and cannot be reused; reset invalidates old sessions. Forgot-password responses remain neutral. Local email is printed in the backend terminal.

Set provider credentials in the root .env and restart Django. Missing credentials disable the provider. Register Web OAuth applications with these exact local callback URLs:

| Provider | Variables | Callback |
| --- | --- | --- |
| Google | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | http://127.0.0.1:5173/api/v1/auth/oauth/google/callback/ |
| GitHub | GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET | http://127.0.0.1:5173/api/v1/auth/oauth/github/callback/ |
| Microsoft | MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT | http://127.0.0.1:5173/api/v1/auth/oauth/microsoft/callback/ |

Microsoft uses the common tenant by default; registration must allow the corresponding account types. Google testing mode requires permitted test users. Provider identities use state/PKCE and are never automatically merged by email. Existing users must sign in and explicitly connect a provider. Connection/disconnection requires authentication within five minutes or password confirmation and cannot remove the final usable method. Provider tokens are not retained.

PostgreSQL-backed rate limits cover login, signup, reset and provider/security actions. Periodically run clear_auth_attempts to remove old counters. Proxy trust and network limits depend on deployment.

Production uses config.settings.production, an HTTPS FRONTEND_URL, SMTP EMAIL_BACKEND and EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, EMAIL_USE_TLS and DEFAULT_FROM_EMAIL. It enables HTTPS redirects and Secure cookies. Hosting, backups, live provider consent and SMTP delivery require environment-specific verification.
