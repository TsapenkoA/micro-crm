# Micro-CRM

A local CRM for freelancers and small agencies, built with Django/DRF, React/TypeScript/Vite/Tailwind, and PostgreSQL. It provides session authentication, workspace-based company access, and the Clients REST API. Frontend business sections currently display placeholders.

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

`createsuperuser` prompts for credentials to sign in to the UI and automatically creates a workspace and membership. There is no admin UI or public registration flow. No public seed data or default password is provided. Django hashes user passwords.

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

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/v1/health
```

Expect `status=ok` and `database=ok`. An unavailable database returns HTTP 503. Django does not serve the frontend build; local development uses Vite. Production deployment is outside the current scope.

## Checks

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
