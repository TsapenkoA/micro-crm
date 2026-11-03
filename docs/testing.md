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
- Frontend navigation and sign-in, CSRF acquisition after session restoration, token rotation, normalized field/API/network errors, and no server traceback display.
- Clients list rendering, explicit search submission, pagination, loading/retry/empty/no-match states, required name and invalid email, trimmed writable-field submissions, duplicate-submit prevention, and server field errors.
- Refetch after create/edit/delete, deletion confirmation and 409 feedback, actual detail data, 404 handling, Escape, focus containment/restoration, light/dark rendering, and global quick actions.
- Two employee accounts sharing a newly created client after a fresh request, and client state reset for an unrelated account. These UI tests mock API responses; PostgreSQL tests separately verify the server's workspace isolation.
- Full cross-module browser E2E tests are not implemented.

## Verified results

The latest backend regression run passed all 91 tests on PostgreSQL 18.6. The prior targeted client ordering and detail selection passed 6 tests (38 deselected). No backend schema or financial logic changes were introduced for the Clients interface.

Frontend verification passed all 22 tests across 3 files. TypeScript checking and the production build succeeded. Run the client UI checks separately with `npm.cmd test -- tests/Clients.test.tsx`.

A live HTTP check also verified health, login/CSRF, client creation, shared access and updates, foreign-workspace detail/search isolation, workspace injection rejection, deletion, logout, and post-logout denial. Populated legacy data preservation is covered by isolated-schema integration tests.

The actual frontend API modules were bundled in memory and exercised through the running Vite proxy with temporary employee accounts. Session/CSRF handling, creation, colleague visibility, restored-session reads/writes, field validation, editing, and deletion passed. This checks real HTTP integration, not browser layout or interaction.

## Pending browser acceptance

The browser interaction scenario was not completed. Visual appearance, actual-browser focus behavior, and mobile layout have not been visually verified. Automated component tests and successful HTTP checks do not substitute for this acceptance step.

With PostgreSQL, Django, and Vite running, sign in and open `#/clients`:

1. Create a client, reload, and confirm the saved contact remains visible.
2. Edit the contact, reload, and confirm the updated values.
3. Sign in as a colleague of the same workspace and refresh; confirm the contact is shared.
4. Open details, navigate by keyboard, close with Escape, and verify focus returns without losing the list position.
5. Check light/dark themes and narrow-screen layout.
6. Delete a disposable test client after confirmation; verify a protected client instead displays an error and remains intact.

Test coverage does not establish production readiness: rate limiting, backup policy, public registration, deployment security, and the remaining business-module flows require additional work.
