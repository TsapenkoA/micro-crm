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

Targeted Invoices API, concurrent numbering and historical migration checks:

```powershell
uv run pytest tests/test_invoices.py tests/test_workspace_migration.py
```

Invoice tests cover per-item 0/5/20/100 percent tax, Decimal and 0/2/3/4-digit currency rounding, invalid/oversized input rollback, seller/buyer snapshots, draft replacement, Sent/Paid immutability, paid_at, colleague access, foreign-workspace 404, CSRF, filters/pagination and concurrent numbering. The migration test starts with populated legacy invoice/item records and verifies that original values remain after both invoice migrations. PDF tests additionally check content type, filename, Cyrillic extraction, multiple pages, totals, anonymous denial and foreign-workspace 404. Component tests cover list/detail, draft validation and save/refetch, PDF failure and empty state. Actual-browser create/refresh/print acceptance is still unverified.

Targeted Deals API and actual PostgreSQL concurrency checks:

```powershell
uv run pytest tests/test_deals.py -q
uv run pytest tests/test_deals.py -k two_concurrent_patches -q
```

From frontend:

```powershell
npm.cmd test
npm.cmd run build
```

Targeted live Deals checks: `npm.cmd test -- tests/Deals.test.tsx tests/deals-api.test.ts` from frontend.

Backend tests run on PostgreSQL, not SQLite. The local application role has no CREATEDB privilege; an administrator precreates test_micro_crm, owned by the application role. pytest uses --reuse-db and applies new migrations. Never point the test runner at the working database or use a shared database for test data.

Migration tests create a unique temporary schema inside the test database, migrate from the personal-ownership schema with historical models, insert legacy records, and apply the current migration chain. They restore search_path and remove only their generated test schema afterward. The role must be able to create schemas in its test database. No working-database rollback or destructive reset is performed.

## Coverage

- Existing session login/logout/me, CSRF rotation, missing/invalid CSRF, untrusted Origin, inactive users, and invalidated sessions.
- Clients create/list/detail/PUT/PATCH/delete; empty results, validation, newest-first sorting with a descending UUID tie-breaker, search by name/company/email, pagination, protected fields, and missing IDs.
- Detail-only read-only deals with Decimal strings and deadlines, empty deals arrays, colleague-created deals, exclusion of other clients' deals, and rejection of foreign-workspace deals even when a stored client link is inconsistent. The list now includes a workspace-scoped deal_count; create/update response shapes remain unchanged.
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
- Deals API: complete CRUD and persistence, shared colleague writes/deletion, foreign deal/client 404, inconsistent stored client/workspace exclusion, membership/session/CSRF/Origin checks, protected-field rejection, invalid money/currency/deadline/title, required fields and versions, stable newest-first pagination and the 100-record cap, search/filters, empty results and exact status/currency totals over all matching pages.
- All 25 status-to-status combinations, each archived outcome, reopening, paid_at creation/preservation/clearing/re-entry, restricted status DTO, stale writes/deletion and version exhaustion without partial changes.
- Two real concurrent PostgreSQL requests for both generic PATCH and PATCH status, using separate connections and two workspace colleagues. A barrier places both requests immediately before their UPDATE. Exactly one returns 200, the other 409; the stored record matches the winner and version advances once. Only scheduling is synchronized; database updates and conflict handling are not mocked.
- Live Deals UI: five board columns and table, server totals and exact large Decimal-string display, preview-style inline detail panel with English dates and client-notes navigation, English deadline calendar and timezone-qualified submission, empty/loading/error/retry states, submitted search, filters, refetch after writes, creation/validation/duplicate-submit prevention, detail 404, confirmed deletion, stale-edit draft preservation and comparison, successful status moves, and rollback/error persistence for 403/409/500. Drag callbacks and API results are mocked at their boundaries; pointer coordinates and browser gestures are not exercised.
- Client list deal_count integration: the PostgreSQL test includes a colleague's deal and an inconsistent foreign-workspace link, verifies only the company deal is counted, and confirms the count is absent from update responses. UI tests cover the list count, real deal links, identity/contact details, and English deadlines.
- Live Deals API client: all-page deal/client loading, ID deduplication, separate currency totals, encoded search, shared-request version/CSRF payloads, and exact Decimal formatting.

## Verified results

The latest backend regression passed all 287 tests on PostgreSQL 18.6 in 32.59 seconds, including the new client deal-count isolation check and all 286 previously passing tests. Command: `.\.venv\Scripts\python.exe -m pytest -q --tb=short -x` from backend. Both actual concurrent edit/status tests passed with exactly one success and one 409. No business model, migration or invoice rule was changed.

The first test attempt could not reach the stopped PostgreSQL server; the existing cluster was started and recovered normally before successful execution. Regression then found the missing accounts/password_reset.txt template referenced by existing auth code. Restoring that plain-text template resolved the failure without changing auth behavior. Tests ran only against the separate test database. No working records were reset, reassigned or created by this feature verification.

Earlier local and production settings checks passed; production used temporary SMTP/HTTPS configuration values without sending mail. These are previous auth verification results, not a production deployment check for the Deals feature.

The latest frontend verification passed all 80 tests across 8 files in 11.68 seconds. Six overlapping prototype-interaction checks were removed from Preview.test.tsx; live Deals/Clients tests retain the saved-data behavior. The Deals checks cover whole amounts without `.00`, preserved cents and selection of a deadline from an English calendar with an ISO UTC submission. `npm.cmd run build` passed TypeScript and Vite production bundling (58 modules). Commands were run from frontend. The targeted Deals/Clients/App run passed 39/39. Auth.test.tsx contains 16 cases; client.test.ts verifies rate-limit messages and distinguishes session expiry from CSRF errors. Component tests do not establish responsive-browser acceptance.

Preview.test.tsx now verifies public rendering without account/business fetch calls and confirms that its invoice document is labeled unsaved with export disabled. The detailed board/client/deal interaction checks were removed because the authenticated screens have their own focused tests. The preview remains fictional and does not write to PostgreSQL.

The running Vite server returned HTTP 200 for /preview and served VisualWorkspace.tsx. Actual-browser visual inspection, responsive screenshots, real Deals dragging, create/reload/edit/delete, and browser interaction acceptance remain NOT VERIFIED: the browser access host and native pipe were unavailable. The CSS implements desktop/tablet/phone breakpoints, but component tests do not prove their rendered appearance.

Auth appearance checks also cover accessible System/Light/Dark icon buttons, their pressed state and persisted preference, plus decorative provider SVGs retaining clear text labels and disabled-provider behavior.

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

Test coverage does not establish production readiness: SMTP/provider acceptance, operational backup policy, proxy/deployment security, browser acceptance and remaining business-module flows require further verification. Public registration and database-backed auth rate limits are implemented.

## Authentication acceptance

Seven Google-specific tests in test_google_signup.py use the installed GoogleOAuth2Adapter.complete_login and GoogleProvider profile mapping without replacing them. Only the external token exchange and decoded ID-token/userinfo boundary are mocked. Both profile formats create User/Workspace/Membership and a verified social email, establish a session and retain the same account/workspace on repeat login. Further checks cover an existing password account with a shared workspace, explicit connection, returning UID with changed email, a different UID claiming the same email, and provisioning rollback. The frontend also checks Dashboard navigation after an OAuth success result. Targeted runs passed 7 Google backend cases and all 16 Auth UI cases; the full suites passed 193 backend and 59 frontend tests.

The account-conflict result is intentional for an unconnected provider whose email already belongs to a local primary/social identity. It does not indicate that a new, unused email was rejected. Existing provider UID lookup precedes this collision check. These tests do not replace real external-provider consent/callback acceptance.

Username/profile coverage adds 13 PostgreSQL cases for required/invalid/taken names, concurrent same-name signup with different emails, authenticated profile changes, CSRF/Origin, rejection of foreign account fields, retained note authorship, and preservation of custom/shared workspace names. Auth UI tests check chosen-username submission, field errors and existing-profile edits. Targeted command: `uv run pytest tests/test_profile.py tests/test_auth_flows.py` (45 passed).

The running Google start endpoint also passed a real HTTP check with local credentials: configured=true, expected redirect_uri, matching configured client, state and S256 PKCE. The check did not complete Google consent or exchange an actual authorization code. Its temporary session/state and rate-limit attempt were removed; signup counters were untouched.

Backend tests cover atomic signup/provisioning rollback, concurrent same-email signup on separate PostgreSQL connections, email normalization and legacy ambiguity, domain/workspace assignment rejection, password validation, anonymous CSRF and untrusted Origins, neutral reset responses, malformed/expired/reused tokens, SMTP failure privacy, current/other session behavior, persistent throttles/window recovery and recent identity confirmation.

Each provider's real allauth start/callback pipeline is exercised with the token exchange and provider profile response mocked. Checks include PKCE authorization parameters, single-use state/replay rejection, new/returning identity, stable workspace, inactive accounts, primary/historical email collisions, invalid profile email, explicit connection, foreign account ownership, recent-auth gates and final-method protection. These are mocked integration tests, not live-provider sign-in.

UI tests cover password visibility, keyboard submission, signup validation/field errors/pending state, reset request errors and neutral messages, reset-token submission/removal, invalid links, OAuth failure/results, disabled unconfigured providers, protected-route restoration/session expiry, password settings, and disconnect confirmation/final-method protection.

A real HTTP smoke check through the running Vite proxy passed signup for three independent workspaces, trusted assignment of B to A, shared client/note/link reads, C isolation, reset request/submission, token-reuse rejection, old-session denial, email login, method metadata and unconfigured-provider rejection. The reset token for this check was generated directly for the temporary test account; inbox delivery was not tested. Temporary users/business records/sessions were removed afterward. This was HTTP integration, not browser interaction.

| Acceptance | Status | Evidence or limitation |
| --- | --- | --- |
| Password/signup/reset backend and Clients regression | PASS | 193 PostgreSQL tests; real HTTP smoke |
| Auth component flows and build | PASS | 59 UI/API-client tests; TypeScript/Vite build |
| Google/GitHub/Microsoft mocked callback pipelines | PASS | State/PKCE, identity, collision, linking and error integration tests |
| Existing working data preserved | PASS | Full field comparison around backed-up auth migration |
| Google live sign-in | NOT VERIFIED | Local credentials/start endpoint configured and checked; Google consent/callback completion pending |
| GitHub live sign-in | NOT VERIFIED | Local credentials/start endpoint configured and checked; GitHub consent/callback completion pending |
| Microsoft live sign-in | NOT VERIFIED | Local credentials/start endpoint configured and checked with common/User.Read; consent/callback completion pending |
| SMTP delivery | NOT VERIFIED | Console development backend; no production SMTP configured |
| Actual-browser keyboard/mobile/theme flow | NOT VERIFIED | Browser access host unavailable |

For manual acceptance, open /sign-up, create a disposable account, sign out and sign in by email with keyboard/password toggle, request a reset and use the backend console link, verify the old password/session fails, then change the password in Settings. Check widths 390/768/1280–1440 and both themes. With real provider credentials, separately test signup, repeat login, cancellation, existing-email collision, Settings connect/unlink and social-only first-password setup for each provider. Never mark a provider PASS solely from mocks.

## Workspace preview data

The local admin workspace preview snapshot was moved from frontend source into its own PostgreSQL `PreviewDataset` row. It is fetched only after sign-in. `python -m pytest tests/test_workspace_counts.py -q` passed 2 tests, including anonymous denial and workspace isolation. `npm test -- --run tests/Preview.test.tsx` passed 8 component tests with generic mock records. `npm run build` passed TypeScript checking and Vite production compilation. Browser visual verification was not performed because browser control was unavailable. Live business records were not changed by the preview snapshot migration.

## Dashboard checks

`cd backend && uv run python -m pytest tests/test_dashboard.py -q` verifies empty and invalid filters, workspace and currency isolation, separate paid-deal and paid-invoice metrics, lost/cancelled outcomes, month/quarter rows, and currency precision against PostgreSQL. `cd frontend && npm test -- Dashboard.test.tsx` verifies server KPI rendering, currency/period refetches, empty values and API retry.

After Dashboard integration, the full PostgreSQL suite passed 317 tests in 27.79 seconds; the four Dashboard-focused tests passed separately. The full frontend suite passed 91 tests across nine files; TypeScript and the production build passed. Browser screenshots, real viewport checks and real-browser chart interaction remain unverified.

## Live invoices and PDF

After Invoices UI and PDF integration, `uv run python -m pytest` passed 318 PostgreSQL tests in 47.10 seconds; the 25 invoice-focused tests also passed separately. `npm test` passed 95 tests across 10 frontend files in 16.71 seconds when run separately from the build. `npm run build` passed TypeScript and Vite compilation. A concurrent frontend test/build/backend run had one App test hit the 5-second timeout; a clean standalone rerun passed all 95 tests. A locally generated PDF was rendered and visually checked after fixing its tax-rate display. The local admin workspace API smoke returned 12 invoices and nonzero revenue buckets for both USD and EUR. Browser invoice editing, PDF download and print dialog remain unverified.

The Invoice UI follow-up checks the USD/EUR summary totals independently of list filters, the status buttons, and the retained search request. The `createRequested` flow now waits for clients to load before opening the form. Local API smoke after adding EUR examples returned 16 invoices, an EUR active pipeline of `21900.00`, EUR paid-invoice revenue of `12810.00` and five nonzero monthly buckets. These are local demonstration data, not test fixtures in source.

The full frontend suite then passed 96 tests across 10 files in 13.05 seconds. TypeScript and the Vite production build passed. The backend code was unchanged in this follow-up; its previous 318-test PostgreSQL run remains the latest full backend result. Browser visual acceptance for the revised Invoices layout remains unverified.
