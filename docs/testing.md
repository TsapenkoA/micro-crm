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
- Notes/links API: required fields and limits, server-controlled author/client/timestamp, chronological pagination, shared colleague access, other-company 404, missing membership, CSRF/Origin, input identity injection, http/https validation, and model rejection of non-http links.
- History UI: empty/loading/error/retry states, personal authors and local timestamps, plain-text XSS-safe note rendering, safe external links, disabled unsafe legacy URLs, preserved rejected drafts, server field errors, confirmed writes and refetch, last-page navigation, remount persistence, and shared timelines across employee accounts.
- Note deletion: author-only permissions and per-viewer can_delete, colleague/superuser denial, workspace and parent isolation, missing IDs, session/CSRF/membership checks, preserved related records, UI confirmation/cancel, pending-state protection, retained notes after failures, and recovery after deleting the only note on the last page.

## Verified results

The latest backend regression run passed all 141 tests on PostgreSQL 18.6, including 49 notes/links checks. The migration check reported no changes. Authentication checks cover the active workspace display DTO and a missing membership returning null while Clients access remains denied. No schema or financial logic changes were introduced.

Frontend verification passed all 42 tests across 4 files. TypeScript checking and the production build succeeded. Added coverage includes workspace display, navigation toggle/Escape/focus restoration, applied-search reset, System theme changes and persisted explicit preferences. These are component tests, not responsive-browser proof. Targeted commands: `npm.cmd test -- tests/App.test.tsx tests/Clients.test.tsx` from frontend and `uv run pytest tests/test_auth.py tests/test_clients.py tests/test_client_history.py tests/test_workspaces.py tests/test_workspace_migration.py` from backend. The history UI file contains 16 passing tests.

A live HTTP check also verified health, login/CSRF, client creation, shared access and updates, foreign-workspace detail/search isolation, workspace injection rejection, deletion, logout, and post-logout denial. Populated legacy data preservation is covered by isolated-schema integration tests.

The actual frontend API modules were bundled in memory and exercised through the running Vite proxy with temporary employee accounts. Session/CSRF handling, creation, colleague visibility, restored-session reads/writes, field validation, editing, and deletion passed. This checks real HTTP integration, not browser layout or interaction.

The history smoke check also exercised those modules against real HTTP endpoints: login → create client → add note and link → reload modules while retaining the session → read persisted history. A second employee read the first employee's note/link and added a note with their own author ID. Another workspace received 404 for history reads and writes. Unsafe URLs and author injection returned 400; client deletion with history returned 409. Temporary smoke records and accounts were removed afterward. This is not a browser reload test.

## Pending browser acceptance

Token-level WCAG contrast calculations passed for normal text, muted text, accent/button text and status text on their corresponding backgrounds in both themes (at least 4.5:1), and for input borders on their surface (at least 3:1). Light muted text on the page background was corrected from 4.41:1 to 4.80:1. These calculations do not verify rendered browser states or replace the visual checks below.

The browser interaction scenario was not completed. The embedded browser connection was unavailable; the native browser attempt was stopped before acceptance could be completed. No accepted Clients light/dark desktop/mobile screenshots were produced. Visual appearance, actual-browser focus behavior, and mobile layout have not been visually verified. Automated component tests and successful HTTP checks do not substitute for this acceptance step.

With PostgreSQL, Django, and Vite running, sign in and open `#/clients`:

1. Create a client, reload, and confirm the saved contact remains visible.
2. Edit the contact, reload, and confirm the updated values.
3. Sign in as a colleague of the same workspace and refresh; confirm the contact is shared.
4. Add a note and an http/https link, reload and reopen the client, and confirm their persistence. Verify the note's author and local timestamp, plain-text rendering of markup, safe external navigation, and colleague history refresh.
5. On your own disposable note, select Delete note, check Cancel, then confirm deletion and reopen the drawer. Verify the note remains deleted and colleagues have no deletion control for other authors' notes.
6. Open details, navigate by keyboard including the note textarea, close with Escape, and verify focus returns without losing the list position.
7. Check light/dark themes at widths 390, 768, 1280 and 1440px. Capture real Clients screenshots for both themes on desktop and mobile. Check contrast, long contacts, navigation toggle/Escape, dialog bounds, focus visibility and absence of horizontal page overflow. Check System theme changes and initial page appearance after reload.
8. Delete a disposable client with no history after confirmation; verify a protected client instead displays an error and remains intact.

Test coverage does not establish production readiness: rate limiting, backup policy, public registration, deployment security, and the remaining business-module flows require additional work.
