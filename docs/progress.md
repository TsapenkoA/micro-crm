# Implementation status

## Foundation

Django/DRF, React/TypeScript/Vite/Tailwind, PostgreSQL configuration, health API, session/CSRF authentication, six business models, migrations, navigation, and automated tests are implemented.

## Company access and Clients API

Workspace and WorkspaceMembership provide company access, with database enforcement of one workspace per user, automatic user provisioning, a trusted local assign_workspace command, and migration from personal ownership. Client/Deal/Invoice belong to workspaces and preserve original owner identity as created_by. Child records retain their parent relationships and inherit workspace through them. Invoice numbers are unique per workspace.

Clients GET/POST list and GET/PUT/PATCH/DELETE detail routes support validation, newest-first ordering (`-created_at`, `-id`), search, pagination, workspace isolation, CSRF protection, and controlled protected-deletion responses. GET detail includes read-only related deals from the current workspace, or an empty array. List and write response shapes remain unchanged. Routes have no trailing slash.

## Validation

The latest backend run passed all 91 tests on PostgreSQL, including the existing regression suite. The targeted client ordering and detail selection passed 6 tests. The migration check reported no changes. The existing frontend baseline remains 3 passing tests with successful TypeScript checking and build; those checks were not rerun for these API-only changes. Migration tests cover populated legacy data preservation and rejection of inconsistent deal, invoice, and note relationships. See [testing.md](testing.md) for commands and coverage.

## Limitations and remaining features

Company assignment is a trusted local operation and cannot transfer populated workspaces. Cross-workspace model relationships are checked by application validation; bulk/direct SQL bypasses those checks. Raw fixtures and bulk user imports need explicit membership provisioning. The data migration is intentionally irreversible; recovery requires a backup or a reviewed forward migration.

The Clients backend is ready for frontend integration. The Clients frontend, notes/links APIs, Deals and Invoices APIs, PDF generation, and analytics are not implemented. Public invitations and complex roles are outside the current scope.
