# Micro-CRM

A local CRM for freelancers and small agencies, built with Django/DRF, React/TypeScript/Vite/Tailwind, and PostgreSQL. It provides session authentication, workspace-based company access, connected Clients, Deals and Invoices interfaces, PDF invoice export/print, and a live financial Dashboard.

## Visual design preview

Sign in, then open [the design preview](http://127.0.0.1:5173/preview#/deals) with Vite and Django running. It shows the intended Dashboard, five-column Deals Kanban/table/detail panel, Clients, Invoices/document editor and Settings in light/dark/system themes. Use the navigation, filters, cards and quick-action forms to explore the design.

The preview's sample contacts, deals and invoices are stored in a separate workspace-scoped `PreviewDataset` row, not in frontend source or live business tables. The existing local admin workspace has a populated dataset; new workspaces show an unavailable state until a dataset is added. Forms update memory only and reset on reload. Preview invoice calculations and charts illustrate layout; the authenticated Dashboard uses real analytics data. Preview drag-and-drop and document export/print are not connected. Live Clients, Deals, Invoices, Dashboard, and account settings are available in the normal application.

## Environment

Windows 11, PowerShell, Python 3.12 managed by `uv`, Node.js 24, npm 11, and PostgreSQL 18. Python dependencies are locked in `backend/uv.lock`; frontend dependencies are locked in `frontend/package-lock.json`. Use `npm.cmd` if PowerShell blocks `npm.ps1`. No execution policy or system PATH changes are needed.

## PostgreSQL and environment variables

Create `.env` from `.env.example` in the repository root. Keep an existing configured `.env` instead of replacing it.

```powershell
Copy-Item .env.example .env
uv run --python 3.12 --no-project python -c "import secrets; print(secrets.token_urlsafe(50))"
```

Copy the generated value into `DJANGO_SECRET_KEY`. Set `PGDATABASE=micro_crm`, `PGUSER=micro_crm`, your own `PGPASSWORD`, `PGHOST=localhost`, and `PGPORT=5432`. Keep secrets out of Git.

Check the server:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe' -h localhost -p 5432
```

If the existing cluster is stopped and you have permission to start it:

```powershell
New-Item -ItemType Directory -Force .local
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' start -D 'C:\Program Files\PostgreSQL\18\data' -l "$PWD\.local\postgres.log" -w
```

Do not reinitialize an existing data directory. Ask an administrator to start the server if you lack access. To stop it when no longer needed, use `pg_ctl.exe stop -D 'C:\Program Files\PostgreSQL\18\data' -m fast` with the same absolute executable path. This stops the entire local cluster, so account for other applications using it.

As a PostgreSQL administrator, create a role and two separate databases once (pgAdmin Query Tool, connected to `postgres`, with auto-commit enabled). Replace the password with your own value. The application role does not need SUPERUSER, CREATEROLE, or CREATEDB:

```sql
CREATE ROLE micro_crm LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER PASSWORD 'replace-with-a-local-secret';
CREATE DATABASE micro_crm OWNER micro_crm;
CREATE DATABASE test_micro_crm OWNER micro_crm;
```

Do not rerun these commands for existing roles or databases. Tests use only `test_micro_crm`, run with `--reuse-db`, and preserve that database after each run. If the application database has another name, prepare a test database with the `test_` prefix. New migrations are applied to the preserved test database when the schema changes. Do not use `--create-db` with a role lacking CREATEDB; an administrator can prepare a new empty test database when a clean verification is needed.

## Backend

From the repository root:

```powershell
Set-Location backend
uv sync --locked
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver 127.0.0.1:8000
```

`createsuperuser` is optional for a trusted local administrator and automatically creates a workspace and membership. Regular users can register at `/sign-up`. No admin UI, public seed data or default password is provided. Django hashes user passwords.

## Company workspaces and employees

Each user belongs to one workspace, enforced by a unique user relationship in WorkspaceMembership. Members share their company's clients. Even superusers receive only their workspace's Clients API data. There are no company roles, public invitations, or membership editing APIs.

To create a regular employee, run `uv run python manage.py shell` from `backend/`, then enter:

```python
from getpass import getpass
from django.contrib.auth import get_user_model
get_user_model().objects.create_user(username="teammate", password=getpass("Password: "))
```

Exit the shell. Find the existing company's workspace UUID (replace `admin` if needed):

```powershell
uv run python manage.py shell -c "from apps.accounts.models import WorkspaceMembership; print(WorkspaceMembership.objects.get(user__username='admin').workspace_id)"
uv run python manage.py assign_workspace teammate <workspace-uuid>
```

Replace `<workspace-uuid>` with the printed UUID; do not include angle brackets. The command requires trusted local shell/database access. It is idempotent and refuses to move a user out of a workspace containing clients, deals, or invoices. It does not transfer records or delete the old empty workspace. Use a reviewed migration for moving existing company data.

New users created through normal Django saves receive their own workspace automatically, then may be explicitly assigned as above. Bulk user creation and raw fixtures bypass provisioning; explicitly create their membership before enabling access. An account without membership receives HTTP 403 from Clients API.

### Upgrading a database with personal ownership

Stop application processes and take a PostgreSQL backup before `uv run python manage.py migrate`. Keep the existing database and migration history. New migrations create one workspace per existing user, including `admin`, rename owner to created_by, backfill workspace, and make workspace required. Existing IDs, credentials, timestamps, financial values, snapshots, and child relationships are preserved. Users are never grouped automatically by a company name.

Inconsistent legacy ownership stops the data migration for manual review. The data migration is intentionally irreversible: after colleagues share data, returning to personal ownership is not safe. Use the pre-upgrade backup for recovery, not a reset or automatic reverse migration. Details: [database](docs/database.md) and [decisions](docs/decisions.md).

## Frontend

In another terminal, from the repository root:

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:5173 and sign in with the user you created. Vite proxies `/api` to `http://127.0.0.1:8000`, so CORS is not needed. Use a consistent hostname in the browser. Development servers bind only to loopback by default.

Open `http://127.0.0.1:5173/#/clients` to search, create, edit, inspect, or delete shared company clients. Search runs on submission; Clear resets it, and Refresh retrieves colleagues' latest changes. Open a client to read or add shared notes and http/https links. Notes show their personal author and local time; Refresh notes/links retrieves colleagues' updates. Authors may select Delete note and confirm deletion for their own notes. Colleagues cannot delete another author's notes; links have no edit/delete actions. Remaining history protects clients from deletion. The selected section survives reload. System/Light/Dark themes are available in the sidebar, which displays the workspace name and collapses behind Open menu on mobile. Global New client and New deal actions work from every section; invoice creation remains disabled. Browser acceptance status and the remaining manual checklist are recorded in [testing.md](docs/testing.md).

Open `http://127.0.0.1:5173/#/deals` after signing in to manage real workspace deals. Create a client first, then use New deal to enter a title, client, amount, currency and optional deadline. The deadline picker shows English month and weekday names and sends the selected local date/time as a timezone-qualified value. The five-column board supports dragging a card by its handle or changing status in its side panel; Table provides the same records with sorting and pages. Search, status and currency filters request server data. Refresh retrieves colleagues' changes. Open a card to inspect, edit, archive with an optional outcome, or confirm deletion. Deal details use English dates and link to the client's shared notes; deal-specific notes are not stored. A stale edit shows the current server record without discarding the draft. Amounts and status/currency totals come from the backend. Whole amounts omit trailing `.00` in the interface; saved Decimal values retain two-place precision. The authenticated workspace uses the preview's neutral page/surface palette, including its near-black dark background. Invoice creation and payment processing are not part of Deals.

The Invoices backend supports authenticated workspace-scoped list, create, detail, draft edit, manual status changes and PDF export. It assigns numbers and computes item taxes and totals on the server, then preserves seller and buyer snapshots. The authenticated `#/invoices` route provides the editor, document view, PDF download and browser print. See [the API contract](docs/api.md#invoices-api) for status and data rules.

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/v1/health
```

Expect `status=ok` and `database=ok`. An unavailable database returns HTTP 503. Django does not serve the frontend build; local development uses Vite. Production deployment is outside the current scope.

## Account access

Open http://127.0.0.1:5173/login to sign in by email or username, or `/sign-up` to create an independent personal workspace with a chosen Username. Signup never joins a company by email domain. Existing users can change their nickname in Settings → Account → Profile; generated personal workspace names follow the change, while shared/custom company names are preserved. Forms support password visibility, validation and pending states. `/forgot-password` requests a one-hour, single-use reset link. Development email is printed in the backend terminal, not delivered to an inbox.

Settings → Account lists password/provider methods, supports password changes and explicit provider connection/disconnection, and prevents removal of the last method. Provider changes require a sign-in within five minutes or password confirmation. Social accounts are not automatically merged by email.

Google/GitHub/Microsoft are disabled with Not configured until CLIENT_ID and CLIENT_SECRET environment variables are set. Create Web OAuth apps, register the exact callback URIs, add credentials only to the ignored .env, then restart Django. Provider setup, scopes and SMTP settings: [authentication.md](docs/authentication.md#local-oauth-apps). Live provider sign-in and SMTP delivery remain unverified without external configuration.

Production uses `config.settings.production`, an HTTPS FRONTEND_URL and SMTP configuration. It enables HTTPS redirects/Secure cookies and rejects a missing SMTP host. Deployment is not performed by these setup steps. PostgreSQL-backed auth rate limits are enabled; periodically run `uv run python manage.py clear_auth_attempts` from backend to remove old buckets.

## Verification commands

```powershell
Set-Location backend
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run pytest
Set-Location ..\frontend
npm.cmd test
npm.cmd run build
```

`build` includes TypeScript checking; run it separately with `npm.cmd run typecheck`. Backend tests require a running PostgreSQL server, a valid `.env`, and a precreated test database. PostgreSQL is not replaced with SQLite.

API contracts: [docs/api.md](docs/api.md). Architecture and scope: [docs/architecture.md](docs/architecture.md). Schema and migration: [docs/database.md](docs/database.md). Authentication: [docs/authentication.md](docs/authentication.md). Decisions: [docs/decisions.md](docs/decisions.md). Test results: [docs/testing.md](docs/testing.md). Progress: [docs/progress.md](docs/progress.md). Access policy: [security/README.md](security/README.md).
