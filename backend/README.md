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
        views.py
        serializers.py
        permissions.py
        errors.py
    auth/
        security.py
        oauth.py
        adapters.py
        signals.py
    services/
        calculations.py
        pdf.py
    management/commands/
    migrations/
```

models.py and apps.py stay at the application root for Django's model discovery and application configuration. The other modules have three clear homes: api/ for HTTP handling and validation, auth/ for sessions/providers and account provisioning, and services/ for invoice calculations and PDF rendering. Each package also has an __init__.py.

A request enters through config/urls.py, reaches api/views.py, validates input through api/serializers.py and reads or writes models.py. Workspace access is checked in api/permissions.py. Invoice handlers call services/ for calculations and PDF output. For a new endpoint, update these existing modules and its corresponding test suite; a new application or package is not needed for each entity.

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
| /auth/password, /auth/reauthenticate | POST: change password or confirm identity |
| /auth/providers, /auth/methods | GET: provider configuration and connected methods |
| /auth/providers/<provider> | DELETE: disconnect a provider after recent authentication |
| /auth/oauth/<provider>/start | POST: start provider login or connection |
| /auth/oauth/<provider>/callback/ | GET: provider callback; trailing slash required |
| /workspace/counts, /workspace/preview | GET: workspace counts or isolated design-preview data |
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

Client input accepts name, company, email and phone. The server supplies workspace, creator, IDs and timestamps. Related history or financial records protect clients from deletion (409).

Deals use title, client, amount, currency and an optional timezone-qualified deadline. Statuses are new_lead, negotiation, in_progress, paid and archived; archived outcomes are none, lost or cancelled. Updates, status changes and deletion require the observed integer version. A stale version returns 409. Send decimal amounts as strings.

Invoices accept client, currency, optional seller details and items (description, quantity, unit_price, tax_rate). The backend assigns numbers, calculates currency-specific totals and stores buyer/seller snapshots. Only drafts can be edited. Sent/paid transitions preserve snapshots; payment status is manual, with no payment-provider integration. Dashboard revenue comes from paid invoices; deal metrics come from deals. Currencies are never combined.

## Workspaces and maintenance

Normal user creation provisions a personal workspace. Each user has one membership; members share their company's records. Public signup and matching email domains never join an existing company. There is no public membership-management API.

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
