# Micro-CRM

A local CRM for freelancers and small agencies. The Day 1–2 foundation includes Django/DRF, React/TypeScript/Vite/Tailwind, PostgreSQL, data models, session authentication, navigation, and basic tests. Business modules are not available yet; their interface sections display placeholders.

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

`createsuperuser` prompts for credentials to sign in to the UI. There is no admin UI or registration flow yet. No public seed data or default password is provided; creating a user is sufficient for Days 1–2. Django hashes user passwords.

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

API contracts: [docs/api.md](docs/api.md). Architecture and scope: [docs/architecture.md](docs/architecture.md). Requirement clarifications: [docs/decisions.md](docs/decisions.md). Access policy: [security/README.md](security/README.md).
