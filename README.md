# Micro-CRM

A small CRM for freelancers and agencies: company workspaces, clients and notes, deals, invoices with PDF export, and a financial dashboard. Django/DRF and PostgreSQL power the API; React, TypeScript and Vite power the interface.

## Structure

- [backend/](backend/README.md): application code in crm/, Django configuration, migrations and backend tests.
- [frontend/](frontend/README.md): interface in src/, frontend tests and Vite configuration.
- .env.example: local configuration template. Keep credentials in the ignored .env.

## Local setup

Requires Python 3.12, uv, Node.js 24, npm and PostgreSQL. Use npm.cmd when PowerShell blocks npm.ps1.

Copy .env.example to .env only if a configured .env does not already exist. Set DJANGO_SECRET_KEY to a random value and configure PGDATABASE, PGUSER, PGPASSWORD, PGHOST and PGPORT. Use the same browser hostname throughout development.

Create an application role and separate application/test databases once, as a PostgreSQL administrator:

```sql
CREATE ROLE micro_crm LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER PASSWORD 'your-local-password';
CREATE DATABASE micro_crm OWNER micro_crm;
CREATE DATABASE test_micro_crm OWNER micro_crm;
```

Skip existing roles/databases. If PGDATABASE differs, use test_<PGDATABASE> for the test database.

Start the backend:

```powershell
cd backend
uv sync --locked
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver 127.0.0.1:8000
```

In another terminal:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:5173. Register at /sign-up or use the optional local administrator account. Public registration creates an independent workspace. See the backend README to assign colleagues to a shared workspace.

## First use

1. Sign in or register a personal workspace. Assign a colleague through the backend management command when company data should be shared.
2. Open Clients and create a contact. Its details contain shared notes and links.
3. Open Deals and create a deal for that client. Move it through the board or edit its status in the details panel.
4. Open Invoices, create a draft with line items, then mark it sent or paid. Download its PDF or print it from the document view.
5. Open Dashboard to inspect deal metrics and paid-invoice revenue. Choose USD, EUR, GBP, PLN, AUD, CAD, CHF or JPY as your personal reporting currency; supported original currencies are converted using stored ECB reference rates. The original amounts remain unchanged.

Import ECB rates before using converted analytics, then refresh them daily after publication:

```powershell
cd backend
uv run python manage.py sync_fx_rates --since 2025-12-01
uv run python manage.py snapshot_fx_rates
```

The snapshot command assigns historical rate dates to older paid records after import. If a required rate is unavailable, the affected total is hidden instead of showing a partial amount. See the backend README for supported currencies and date rules.

Account settings contain profile, password/provider methods and appearance. Password reset messages appear in the backend terminal unless email delivery is configured. The optional design preview is separate from live company records; see the frontend README for its limits.

## Checks

```powershell
cd backend
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run pytest
cd ../frontend
npm.cmd test
npm.cmd run build
```

Backend tests require PostgreSQL and the precreated test database. They reuse that database and never use the application database. Back up existing application data before applying migrations.
