# Testing

## Commands

From backend:

```powershell
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run pytest
```

Targeted client ordering and detail checks:

```powershell
uv run pytest tests/test_clients.py -k "list_empty_and_stable_pagination or detail"
```

From frontend:

```powershell
npm.cmd test
npm.cmd run build
```

Backend tests run on PostgreSQL, not SQLite. The local application role has no CREATEDB privilege; an administrator precreates test_micro_crm, owned by the application role. pytest uses --reuse-db and applies new migrations. Never point the test runner at the working database or use a shared database for test data.

Migration tests create a unique temporary schema inside the test database, migrate from the personal-ownership schema with historical models, insert legacy records, and apply the current migration chain. They restore search_path and remove only their generated test schema afterward. The role must be able to create schemas in its test database. No working-database rollback or destructive reset is performed.

## Coverage

- Existing session login/logout/me, CSRF rotation, missing/invalid CSRF, untrusted Origin, inactive users, and invalidated sessions.
- Clients create/list/detail/PUT/PATCH/delete; empty results, validation, newest-first sorting with a descending UUID tie-breaker, search by name/company/email, pagination, protected fields, and missing IDs.
- Detail-only read-only deals with Decimal strings and deadlines, empty deals arrays, colleague-created deals, exclusion of other clients' deals, and rejection of foreign-workspace deals even when a stored client link is inconsistent. List and write response shapes remain unchanged.
- Two colleagues sharing records; another company's list/search/detail/mutations remaining isolated; missing membership failing closed.
- Real session-authenticated API writes requiring CSRF, rejected untrusted Origins, JSON responses for browser requests, and protected invoices/notes/links preventing client deletion.
- New-user provisioning, database membership uniqueness, idempotent employee assignment, invalid targets, refusal to move populated workspaces, and shared model authorship.
- Existing Decimal, UUID, status, version, nonnegative amount, snapshot persistence, and deletion constraints, updated for workspace ownership.
- Full populated legacy migration preservation and atomic rejection of inconsistent old relationships.
- Existing frontend navigation, login form behavior, and typed fetch CSRF handling. The Clients frontend and full business-flow E2E tests are not implemented.

## Verified results

The latest backend run passed all 91 tests on PostgreSQL 18.6. The targeted client ordering and detail selection passed 6 tests (38 deselected). The migration check reported no changes; no schema migration is required for these API changes.

The existing frontend baseline remains 3 passing tests, with successful TypeScript checking and production build. Frontend checks were not rerun for the client ordering and detail changes because no frontend source was changed.

A live HTTP check also verified health, login/CSRF, client creation, shared access and updates, foreign-workspace detail/search isolation, workspace injection rejection, deletion, logout, and post-logout denial. Populated legacy data preservation is covered by isolated-schema integration tests.

Test coverage does not establish production readiness: rate limiting, backup policy, public registration, deployment security, and the remaining business-module flows require additional work.
