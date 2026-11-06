# Implementation status

## Foundation

Django/DRF, React/TypeScript/Vite/Tailwind, PostgreSQL configuration, health API, session/CSRF authentication, six business models, migrations, navigation, and automated tests are implemented.

## Visual design preview

An isolated `/preview` route presents the intended application design ahead of business integration. It includes compact sidebar/navigation, global quick-action forms, five-stage Kanban and table views, a deal detail panel, a sample client list/drawer, dashboard KPI/chart layouts, invoice summaries/list/document preview/editor and appearance/account/workspace layouts. Light/dark/system appearance and mobile menu use the existing theme component. Search, filters, view switches, sample status/edit/create interactions and document arithmetic operate on a workspace-scoped snapshot loaded from the backend. Reload resets local changes; PDF/print are disabled and drag-and-drop remains unconnected.

The preview now requires sign-in and reads a separate `PreviewDataset` row for the current workspace. The local admin workspace retains its sample appearance with 10 clients, 21 deals and 12 invoices. Those records are absent from frontend source and do not change live Client, Deal or Invoice rows. New workspaces without a preview dataset receive 404. Preview component tests use generic test records; backend tests check authentication and workspace isolation. Actual-browser visual acceptance and screenshots remain NOT VERIFIED because browser control is unavailable.

The preview and live sidebar navigation now use neutral text at rest and bold neutral text when selected, adapting to light and dark themes. The targeted preview suite passed 8 tests, the workspace endpoint suite passed 2 PostgreSQL tests, and TypeScript/Vite build passed. Migration `accounts.0004_previewdataset` was applied locally. No full browser visual check was run.

Filled primary actions and selected calendar dates now use black with white text; secondary actions retain their light surface. Preview note text, next-step copy, link label and invoice sender description are also stored in the separate local preview dataset. Frontend source contains no literal preview contact names, email addresses, deal titles or amounts. Preview component tests and production build passed after these changes; browser appearance remains unverified.

## Account access

Account-access code and automated verification are implemented. Final acceptance is PARTIAL: Google/GitHub/Microsoft credentials and start endpoints are configured/checked, but live provider signup/repeat-login/link flows and real-browser mobile/keyboard acceptance have not been completed. Console email and separate production SMTP settings are implemented; production delivery is not claimed.

Password signup now asks for a unique Username. Settings → Profile lets existing users replace generated technical names without changing account IDs, ownership or sessions. An unchanged generated personal workspace name follows the new nickname only when it has one member; shared/custom company names are preserved. Google credentials are stored only in ignored local configuration; the running Google start/callback URI was checked without completing external sign-in.

Standalone auth screens implement email/legacy-username login, signup, password reset and OAuth results with shared themes and pending/error/field states. Settings lists account/workspace and sign-in methods, supports password change/first-password setup, identity confirmation and confirmed provider disconnection. The shared client handles expired sessions without treating every permission/CSRF error as logout.

Public signup provisions a separate workspace transactionally; same-domain emails never join a company automatically. Reset tokens expire after one hour, cannot be reused and invalidate previous sessions. Auth write limits persist in PostgreSQL. django-allauth integrates Google/GitHub/Microsoft authorization-code callbacks with state/PKCE and provider-UID identity. Automatic email merging is disabled, connection requires recent authentication, and the last method cannot be removed.

The real HTTP auth smoke passed signup, personal-workspace separation, explicit A/B assignment/sharing, C isolation, reset/reuse/session checks and email login. Temporary test accounts/records were cleaned up. Live Google/GitHub/Microsoft sign-in is NOT VERIFIED: credentials and start endpoints are configured locally, but consent/callback completion is pending; development email is console-only and production SMTP delivery is NOT VERIFIED. Actual-browser auth/mobile checks remain pending. No production deployment or subsequent feature module was performed.

## Company access and Clients API

Workspace and WorkspaceMembership provide company access, with database enforcement of one workspace per user, automatic user provisioning, a trusted local assign_workspace command, and migration from personal ownership. Client/Deal/Invoice belong to workspaces and preserve original owner identity as created_by. Child records retain their parent relationships and inherit workspace through them. Invoice numbers are unique per workspace.

Clients GET/POST list and GET/PUT/PATCH/DELETE detail routes support validation, newest-first ordering (`-created_at`, `-id`), search, pagination, workspace isolation, CSRF protection, and controlled protected-deletion responses. GET list includes a read-only count of related deals in the current workspace. GET detail includes those related deals, or an empty array. Create/update responses do not include the list-only count. Routes have no trailing slash.

## Clients interface

The Clients page is connected to the existing session/CSRF API. It provides company-wide contacts with initials and server deal counts, submitted search, pagination, manual refresh, create/edit forms, a detail drawer with real related deals, and confirmed deletion. The drawer now uses the preview's identity/contact/deal-card styling, with English display dates and actual created/updated timestamps. Mutations persist through API requests and trigger a list refetch. Forms whitelist writable fields, require a nonblank name, keep email/phone optional, and show server field errors without discarding input. Pending submissions are disabled.

## Deals backend

Implemented workspace-scoped GET/POST list, GET/PUT/PATCH/DELETE detail and PATCH status under /api/v1/deals, without trailing slashes. DTOs validate title, same-workspace client, nonnegative Decimal amount, current uppercase ISO currency and timezone-qualified deadline. Responses contain decimal strings, version, outcome, server timestamps and paid_at. All colleagues share deals; foreign/missing objects return 404. Ownership and server fields cannot be supplied by the browser.

Search, exact status/currency filters, stable newest-first pagination and status/currency totals are implemented. Totals describe the filtered collection before pagination and never combine currencies. Every update requires an observed version and uses a direct single-table compare-and-swap; stale updates/deletion return 409. All five statuses can be reopened or changed; archive does not imply lost. Paid timestamps and archive outcomes follow the documented transition rules without changing invoice logic or revenue.

The existing Deal schema and database constraints are reused unchanged; no migration or working-data rewrite is required. The missing password-reset text template referenced by existing auth code was restored after regression detected its absence. No auth protocol change was made.

## Deals interface

The authenticated `#/deals` route now renders real workspace deals as a five-stage Kanban board or sortable, paginated table. It loads all API pages, supports submitted search, status/currency filters, refresh, an empty state, and a client selector drawn from the same workspace. New deal works in the global quick actions. Cards show real title/client/amount/deadline; the inline detail panel matches the preview's identity/status/tabs layout while exposing actual values, editing, status/outcome changes and confirmed deletion. The Notes tab directs users to the client's real shared history. Client and deal detail views link to each other. The create/edit form now uses an English calendar and 24-hour time selectors, avoiding the browser-native calendar's operating-system locale. All mutations use the existing session/CSRF client and persist through the backend.

Board dragging moves a card optimistically, rolls it back on 403/409/500, reports the failure, and refetches server records and totals. The side panel offers a status selector without dragging. Edit and status writes use the observed version; on conflict the form preserves the draft, loads the latest record for comparison, and requires an explicit discard before replacing the draft. Amount strings are formatted without floating-point conversion; the board displays server-calculated totals by status and currency. Deadline and timestamps render with English month names. Creator names, service categories, next-step text and deal-specific notes are absent from the current API and are not fabricated. The live Deals route is separate from the fictional `/preview` route. Actual browser gesture, visual and reload acceptance remain NOT VERIFIED.

Loading, empty, no-match, success, validation, missing-record, access, protected-deletion, server, and network states are implemented. Native dialogs support Escape, focus trapping/restoration, and scroll locking. The authenticated shell now follows the preview's compact sidebar/header and neutral palette, including near-black dark surfaces; real account/workspace content is preserved. New client and New deal are enabled; invoice creation remains disabled. Hash navigation preserves the selected section after reload. No invitation or role-management interface is added.

## Shared client history

Client notes and links support GET/POST under the workspace-scoped parent client. Notes use the current session's author, server timestamps, and plain text; links validate required labels and http/https URLs. History lists are chronological and paginated. Foreign client IDs return 404, and author/client/workspace input cannot override server identity.

The drawer provides a shared note timeline, link list, forms, independent loading/error/empty states, manual refresh, and pagination. Successful writes refetch the last page; failed writes keep drafts without optimistic entries. React renders note and label content as text, and external links use noopener/noreferrer with a defensive scheme check. Related deals link to their real side panel. No realtime, role matrix, or separate comments module is introduced.

Authors can delete their own notes through the nested DELETE endpoint and a confirmed action in the drawer. The server supplies the per-viewer can_delete hint and enforces authorship independently. Colleagues cannot delete another author's notes, including superusers; foreign clients and mismatched parent/note IDs return 404. Deletion locks membership, parent, and note, preserves other records, and refetches history after success. UI failures retain the note.

## Validation

The latest backend regression passed all 287 tests on PostgreSQL in 32.59 seconds, including the new workspace-isolated client deal-count check. Both concurrent PATCH cases proved one 200, one 409 and a single version increment. No schema/data migration was needed.

The frontend suite passed all 80 tests across 8 files after removing six overlapping preview tests and adding the English deadline-picker check. Display checks cover whole amounts without `.00` and fractional amounts with cents; TypeScript and Vite production build passed (58 modules). These component tests mock the API and drag event boundary, so they do not establish actual browser drag, responsive appearance or reload behavior. Earlier local/production configuration checks passed (production with temporary values, without SMTP delivery). The auth migrations had been applied after a backup and before/after data comparison.

The actual frontend API modules passed a real Vite-proxy smoke check for login, client creation, note/link creation, restored-session history reads, colleague access/authorship, unsafe URL and identity-injection rejection, and foreign-workspace 404. Protected history correctly prevents client deletion. This HTTP check is not a browser interaction test.

The manual browser scenario including note/link persistence after reload, visual inspection, actual-browser keyboard/mobile checks and required screenshots remains pending. See [testing.md](testing.md) for coverage and the remaining checklist.

## Clients and application shell acceptance

The shell now uses navigation icons, displays the actual workspace name in navigation and Settings, supports a collapsible mobile menu with Escape/focus restoration, and provides a skip link. Clients search has an explicit Clear action. Shared styles use named color/status, spacing, typography, radius and shadow tokens. System/Light/Dark preferences persist, with appearance resolved before application rendering. New client and New deal are available across sections; invoice creation remains disabled.

READY means implemented with passing automated coverage. PARTIAL means implementation exists but browser acceptance remains outstanding. No browser check is inferred from component tests.

| Requirement | Code | Evidence | Status |
| --- | --- | --- | --- |
| One workspace per user; colleagues share data; other companies isolated | accounts models, workspace permissions, historical migrations | test_workspaces.py, test_workspace_migration.py, test_clients.py, test_client_history.py | READY |
| Client CRUD, deal counts, validation, protected deletion | clients views/serializers, ClientsPage, ClientForm | test_clients.py, Clients.test.tsx | READY |
| Search/reset, newest-first stable pagination, empty results | ClientList, ClientsPage | test_clients.py, Clients.test.tsx | READY |
| Related workspace deals, including an empty array | ClientDetailSerializer, ClientDetails | test_clients.py, Clients.test.tsx | READY |
| Real Deals board/table, create/edit/status/delete, search/filters and totals | Deals API, DealsPage, DealForm | test_deals.py, Deals.test.tsx, deals-api.test.ts; browser check pending | PARTIAL |
| Shared authored notes and safe links | ClientNotes/ClientLinks, ClientHistory | test_client_history.py, ClientHistory.test.tsx | READY |
| Session/CSRF and active workspace display | accounts views, shared API client, App | test_auth.py, client.test.ts, App.test.tsx | READY |
| Drawer keyboard behavior and retained list | Dialog, ClientsPage | Clients.test.tsx; real-browser check pending | PARTIAL |
| Consistent tokens, themes, responsive shell and global actions | index.css, index.html, ThemeSelect, NavIcon, App | App.test.tsx, Clients.test.tsx, TypeScript/build; visual check pending | PARTIAL |
| Real browser persistence flow, A/B/C sessions and screenshots at required widths | Existing Clients UI/API | API/component coverage passes; browser acceptance not completed | PARTIAL |

Clients and Deals are connected. Final visual and browser acceptance remains NOT VERIFIED; it is not signed off as complete.

## Limitations and remaining features

Password registration, email/legacy-username login, reset, password changes and provider-method settings are implemented. Social callback integration is implemented and tested with mocked provider responses. Google, GitHub and Microsoft are configured locally and their start endpoints are verified; actual external sign-in remains NOT VERIFIED. Microsoft uses common with User.Read. SMTP delivery and real-browser auth/mobile acceptance remain NOT VERIFIED. No production deployment is performed.

Company assignment is a trusted local operation and cannot transfer populated workspaces. Cross-workspace model relationships are checked by application validation; bulk/direct SQL bypasses those checks. Raw fixtures and bulk user imports need explicit membership provisioning. The data migration is intentionally irreversible; recovery requires a backup or a reviewed forward migration.

Contacts, shared notes, and links are implemented across the API and Clients UI; manual browser acceptance remains pending. Note deletion is restricted to its author; note editing and individual link editing/deletion are not implemented. Clients with remaining history remain protected from deletion. Deals backend CRUD/status and live UI are implemented; actual browser acceptance remains pending. Invoices CRUD, PDF generation, and analytics are not implemented. Public invitations and complex roles are outside the current scope.
