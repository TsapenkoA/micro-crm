# Implementation status

## Foundation

Django/DRF, React/TypeScript/Vite/Tailwind, PostgreSQL configuration, health API, session/CSRF authentication, six business models, migrations, navigation, and automated tests are implemented.

## Company access and Clients API

Workspace and WorkspaceMembership provide company access, with database enforcement of one workspace per user, automatic user provisioning, a trusted local assign_workspace command, and migration from personal ownership. Client/Deal/Invoice belong to workspaces and preserve original owner identity as created_by. Child records retain their parent relationships and inherit workspace through them. Invoice numbers are unique per workspace.

Clients GET/POST list and GET/PUT/PATCH/DELETE detail routes support validation, newest-first ordering (`-created_at`, `-id`), search, pagination, workspace isolation, CSRF protection, and controlled protected-deletion responses. GET detail includes read-only related deals from the current workspace, or an empty array. List and write response shapes remain unchanged. Routes have no trailing slash.

## Clients interface

The Clients page is connected to the existing session/CSRF API. It provides company-wide contacts, submitted search, pagination, manual refresh, create/edit forms, a detail drawer with real related deals, and confirmed deletion. Mutations persist through API requests and trigger a list refetch. Forms whitelist writable fields, require a nonblank name, keep email/phone optional, and show server field errors without discarding input. Pending submissions are disabled.

Loading, empty, no-match, success, validation, missing-record, access, protected-deletion, server, and network states are implemented. Native dialogs support Escape, focus trapping/restoration, and scroll locking. Shared design tokens, light/dark themes, responsive client cards, and global quick actions use the existing layout. Only New client is enabled; future deal/invoice actions are clearly disabled. Hash navigation preserves the selected section after reload. No invitation or role-management interface is added.

## Validation

The backend regression run passed all 91 tests on PostgreSQL. Frontend verification passed 22 tests, TypeScript checking, and the production build. Component tests include two colleagues sharing a newly created client after a fresh request and an unrelated account receiving an empty list. The actual frontend API modules were also exercised through the running Vite proxy with separate temporary employee accounts: session/CSRF, create, colleague visibility, restored-session reads/writes, validation, edit, and delete passed. This HTTP check is not a browser interaction test.

The manual browser scenario (create → reload → edit → delete), visual inspection, and actual-browser keyboard/mobile checks were not completed. They remain explicitly pending. See [testing.md](testing.md) for coverage and the remaining checklist.

## Limitations and remaining features

Company assignment is a trusted local operation and cannot transfer populated workspaces. Cross-workspace model relationships are checked by application validation; bulk/direct SQL bypasses those checks. Raw fixtures and bulk user imports need explicit membership provisioning. The data migration is intentionally irreversible; recovery requires a backup or a reviewed forward migration.

The Clients frontend is implemented; manual browser acceptance remains pending. Notes/links APIs, Deals and Invoices CRUD, PDF generation, and analytics are not implemented. Public invitations and complex roles are outside the current scope.
