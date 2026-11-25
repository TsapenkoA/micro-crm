# Micro-CRM

A small CRM for freelancers and agencies: company workspaces, clients and notes, deals, invoices with PDF export, and a financial dashboard. Django/DRF and PostgreSQL power the API; React, TypeScript and Vite power the interface.

## Structure

- [backend/](backend/README.md): application code in crm/, Django configuration, migrations and backend tests.
- [frontend/](frontend/README.md): interface in src/, frontend tests and Vite configuration.
- .env.example: local configuration template. Keep credentials in the ignored .env.

## Local setup

Requires Python 3.12, uv 0.9.16, Node.js 24, npm and PostgreSQL 18. Use npm.cmd when PowerShell blocks npm.ps1. CI uses the same language/runtime versions.

Copy .env.example to .env only if a configured .env does not already exist. Set DJANGO_SECRET_KEY to a random value and configure PGDATABASE, PGUSER, PGPASSWORD, PGHOST and PGPORT. Use the same browser hostname throughout development.

Create an application role and separate application/test databases once, as a PostgreSQL administrator:

```sql
CREATE ROLE micro_crm LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER PASSWORD 'your-local-password';
CREATE DATABASE micro_crm OWNER micro_crm;
CREATE DATABASE test_micro_crm OWNER micro_crm;
```

Skip existing roles/databases. If PGDATABASE differs, use test_<PGDATABASE> for the test database.

Create a protected directory outside the repository for a local recovery key (the example below uses `C:\secure`; choose your own path). Each developer generates their own key and uses their own local database. Never copy a teammate's `.env` or commit keys, database archives or customer files. For an existing database, follow the backup and rehearsal steps in [backend/SECURITY.md](backend/SECURITY.md) before applying encryption migrations.

Start the backend:

```powershell
cd backend
uv sync --locked
uv run python manage.py initialize_data_key --recovery-file C:\secure\microflow-data.key
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

Open http://127.0.0.1:5173. Register at /sign-up or use the optional local administrator account. Public registration emails a verification link; the account and independent workspace are created only after the link is confirmed. Local email appears in the backend terminal unless SMTP is configured. See the backend README to assign colleagues to a shared workspace.

### Linux and macOS

Install Python 3.12, uv 0.9.16, Node.js 24, npm and PostgreSQL 18. Configure a local PostgreSQL role and the `micro_crm` and `test_micro_crm` databases as described above. In the repository root, copy the example environment file only when you do not already have a local `.env`, then set its database values and a random `DJANGO_SECRET_KEY`:

```sh
test -f .env || cp .env.example .env
mkdir -p "$HOME/.config/micro-crm"
cd backend
uv sync --locked
uv run python manage.py initialize_data_key --recovery-file "$HOME/.config/micro-crm/micro-crm-data.key"
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver 127.0.0.1:8000
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Keep the recovery key outside the repository and protect it separately from the database backup.

## First use

1. Sign in or register and verify your email to create a personal workspace. Send a join request from Settings > Workspace when company data should be shared. Trusted administrators can still use the backend management command.
2. Open Clients and create a customer. Its details contain a primary and additional contacts, related invoices, shared notes, editable links and private files.
3. Open Deals and create a deal for that client. Move it through the board or edit its status in the details panel. In Tasks, assign a next step to a teammate with a due time. Check My tasks, Team, Overdue and Upcoming; the Dashboard also shows your next open tasks.
4. In Settings, update your profile photo or workspace name and review members. The workspace owner can send a join request to an existing account; its owner must accept in Settings > Workspace while their personal workspace is empty. The workspace owner can also save both the seller profile and payment details after a recent identity check. Add a client's payer bank details in the client form. Open Invoices, create a draft with line items, a due date and optional deal for the same client. New drafts copy the saved seller profile; older invoices keep their original details. Issue without email or explicitly email the PDF when SMTP is configured. Review overdue invoices, preview and confirm reminders, and record confirmed partial or full payments. Linked invoices and deals open from each other's details; their statuses remain independent.
5. Open Dashboard to inspect deal metrics and revenue from recorded invoice payments. Choose USD, EUR, GBP, PLN, AUD, CAD, CHF or JPY as your personal reporting currency; supported original currencies are converted using stored ECB reference rates. The original amounts remain unchanged.
6. Open Operations to review assigned tasks and upcoming or overdue invoice and deal deadlines. Complete a task there or review the text before manually sending an overdue invoice reminder. Open Activity to see who created, changed or deleted a client, deal, task or invoice. The journal starts when the activity migration is applied; earlier actions cannot be reconstructed.

Import ECB rates before using converted analytics, then refresh them daily after publication:

```powershell
cd backend
uv run python manage.py sync_fx_rates --since 2025-12-01
uv run python manage.py snapshot_fx_rates
```

The snapshot command assigns historical rate dates to older paid records after import. If a required rate is unavailable, the affected total is hidden instead of showing a partial amount. See the backend README for supported currencies and date rules.

Account settings contain profile, password/provider methods and appearance. Password reset messages appear in the backend terminal unless email delivery is configured. The optional design preview is separate from live company records; see the frontend README for its limits. Current architecture decisions are summarized in [docs/architecture-decisions.md](docs/architecture-decisions.md).

## Checks

The backend tests use PostgreSQL. Django creates a separate `test_<PGDATABASE>` database; tests do not write to the configured application database. The CI workflow uses PostgreSQL 18 and contains no local credentials.

```powershell
cd backend
python -m pip install -r requirements-tools.txt
ruff check crm/services/calculations.py crm/services/fx.py
mypy crm/services/calculations.py crm/services/fx.py
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run pytest
cd ../frontend
npm.cmd run format:check
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

On Linux/macOS, use `python -m pip` and `npm` in place of `npm.cmd`; the remaining checks are the same. Ruff and mypy currently check the financial and FX services from `backend/requirements-tools.txt`; React Hooks lint and Prettier are installed with the frontend's locked development dependencies. Back up existing application data before applying migrations.

## Security prerequisites

See [backend/SECURITY.md](backend/SECURITY.md) for workspace consent, CSP, key recovery and the limits of field-level encryption. Set `FILE_SCAN_HOST` and `FILE_SCAN_PORT` for a trusted private ClamAV service before using client file uploads/downloads. Without it, those operations return a controlled 503; tests use a scanner stub only where explicitly declared. Other CRM features do not require the scanner. Storage encryption for the complete PostgreSQL database and backups remains a hosting requirement.

On Windows x64, use `./scripts/start-file-scanner.ps1 -Setup` once and restart Django. Run `./scripts/start-file-scanner.ps1` after restarting Windows. The portable scanner and updater run locally; the script verifies clean/EICAR detection before configuring the application. No binaries, signatures or secrets are committed. See the security instructions for other operating systems and recovery-key handling.
