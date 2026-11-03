# Implementation status

## Foundation

Django/DRF, React/TypeScript/Vite/Tailwind, PostgreSQL configuration, health API, session/CSRF authentication, six business models, migrations, navigation, and automated tests are implemented.

## Company access and Clients API

Workspace and WorkspaceMembership provide company access, with database enforcement of one workspace per user, automatic user provisioning, a trusted local assign_workspace command, and migration from personal ownership. Client/Deal/Invoice belong to workspaces and preserve original owner identity as created_by. Child records retain their parent relationships and inherit workspace through them. Invoice numbers are unique per workspace.

Clients GET/POST list and GET/PUT/PATCH/DELETE detail routes support validation, newest-first ordering (`-created_at`, `-id`), search, pagination, workspace isolation, CSRF protection, and controlled protected-deletion responses. GET detail includes read-only related deals from the current workspace, or an empty array. List and write response shapes remain unchanged. Routes have no trailing slash.

## Clients interface

The Clients page is connected to the existing session/CSRF API. It provides company-wide contacts, submitted search, pagination, manual refresh, create/edit forms, a detail drawer with real related deals, and confirmed deletion. Mutations persist through API requests and trigger a list refetch. Forms whitelist writable fields, require a nonblank name, keep email/phone optional, and show server field errors without discarding input. Pending submissions are disabled.

Loading, empty, no-match, success, validation, missing-record, access, protected-deletion, server, and network states are implemented. Native dialogs support Escape, focus trapping/restoration, and scroll locking. Shared design tokens, light/dark themes, responsive client cards, and global quick actions use the existing layout. Only New client is enabled; future deal/invoice actions are clearly disabled. Hash navigation preserves the selected section after reload. No invitation or role-management interface is added.

## Shared client history

Client notes and links support GET/POST under the workspace-scoped parent client. Notes use the current session's author, server timestamps, and plain text; links validate required labels and http/https URLs. History lists are chronological and paginated. Foreign client IDs return 404, and author/client/workspace input cannot override server identity.

The drawer provides a shared note timeline, link list, forms, independent loading/error/empty states, manual refresh, and pagination. Successful writes refetch the last page; failed writes keep drafts without optimistic entries. React renders note and label content as text, and external links use noopener/noreferrer with a defensive scheme check. Existing real deals remain read-only with an explicit deal-management placeholder. No realtime, role matrix, or separate comments module is introduced.

Authors can delete their own notes through the nested DELETE endpoint and a confirmed action in the drawer. The server supplies the per-viewer can_delete hint and enforces authorship independently. Colleagues cannot delete another author's notes, including superusers; foreign clients and mismatched parent/note IDs return 404. Deletion locks membership, parent, and note, preserves other records, and refetches history after success. UI failures retain the note.

## Validation

The backend regression run passed all 141 tests on PostgreSQL, including 49 notes/links checks. Frontend verification passed all 42 tests, TypeScript checking, and the production build. Coverage includes author-only note deletion, workspace isolation, CSRF, confirmation/cancel, errors, pagination after deletion, shared history, safe rendering, navigation/theme/workspace display, search reset, and existing client workflows. No new migration was detected.

The actual frontend API modules passed a real Vite-proxy smoke check for login, client creation, note/link creation, restored-session history reads, colleague access/authorship, unsafe URL and identity-injection rejection, and foreign-workspace 404. Protected history correctly prevents client deletion. This HTTP check is not a browser interaction test.

The manual browser scenario including note/link persistence after reload, visual inspection, actual-browser keyboard/mobile checks and required screenshots remains pending. See [testing.md](testing.md) for coverage and the remaining checklist.

## Clients and application shell acceptance

The shell now uses navigation icons, displays the actual workspace name in navigation and Settings, supports a collapsible mobile menu with Escape/focus restoration, and provides a skip link. Clients search has an explicit Clear action. Shared styles use named color/status, spacing, typography, radius and shadow tokens. System/Light/Dark preferences persist, with appearance resolved before application rendering. New client remains available across sections; future deal/invoice actions remain disabled.

READY means implemented with passing automated coverage. PARTIAL means implementation exists but browser acceptance remains outstanding. No browser check is inferred from component tests.

| Requirement | Code | Evidence | Status |
| --- | --- | --- | --- |
| One workspace per user; colleagues share data; other companies isolated | accounts models, workspace permissions, historical migrations | test_workspaces.py, test_workspace_migration.py, test_clients.py, test_client_history.py | READY |
| Client CRUD, validation, protected deletion | clients views/serializers, ClientsPage, ClientForm | test_clients.py, Clients.test.tsx | READY |
| Search/reset, newest-first stable pagination, empty results | ClientList, ClientsPage | test_clients.py, Clients.test.tsx | READY |
| Related workspace deals, including an empty array | ClientDetailSerializer, ClientDetails | test_clients.py, Clients.test.tsx | READY |
| Shared authored notes and safe links | ClientNotes/ClientLinks, ClientHistory | test_client_history.py, ClientHistory.test.tsx | READY |
| Session/CSRF and active workspace display | accounts views, shared API client, App | test_auth.py, client.test.ts, App.test.tsx | READY |
| Drawer keyboard behavior and retained list | Dialog, ClientsPage | Clients.test.tsx; real-browser check pending | PARTIAL |
| Consistent tokens, themes, responsive shell and global actions | index.css, index.html, ThemeSelect, NavIcon, App | App.test.tsx, Clients.test.tsx, TypeScript/build; visual check pending | PARTIAL |
| Real browser persistence flow, A/B/C sessions and screenshots at required widths | Existing Clients UI/API | API/component coverage passes; browser acceptance not completed | PARTIAL |

Clients is implemented for integration with future Deals work. Final visual and browser acceptance remains NOT VERIFIED; it is not signed off as complete.

## Limitations and remaining features

Company assignment is a trusted local operation and cannot transfer populated workspaces. Cross-workspace model relationships are checked by application validation; bulk/direct SQL bypasses those checks. Raw fixtures and bulk user imports need explicit membership provisioning. The data migration is intentionally irreversible; recovery requires a backup or a reviewed forward migration.

Contacts, shared notes, and links are implemented across the API and Clients UI; manual browser acceptance remains pending. Note deletion is restricted to its author; note editing and individual link editing/deletion are not implemented. Clients with remaining history remain protected from deletion. Deals and Invoices CRUD, PDF generation, and analytics are not implemented. Public invitations and complex roles are outside the current scope.
