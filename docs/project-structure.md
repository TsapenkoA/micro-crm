# Project structure

| Path | Responsibility |
| --- | --- |
| backend/config/ | Django settings, root API routes, ASGI and WSGI entry points |
| backend/apps/accounts/ | Sessions, workspace membership, user provisioning, and local employee assignment |
| backend/apps/clients/ | Client models, scoped CRUD, search, pagination, and read-only related deals |
| backend/apps/deals/ | Deal model and database constraints; no Deals CRUD endpoint yet |
| backend/apps/invoices/ | Invoice/item models and constraints; no invoice editor or PDF endpoint yet |
| backend/apps/analytics/ | Reserved for financial aggregation |
| backend/common/ | Shared validation, workspace permissions, health checks, and API errors |
| backend/tests/ | PostgreSQL integration, model, authentication, workspace, and migration tests |
| frontend/src/app/App.tsx | Existing sidebar layout, hash navigation, session restoration, theme selection, and global quick actions |
| frontend/src/api/client.ts | Shared typed fetch, session cookies, CSRF acquisition, and normalized API/network errors |
| frontend/src/components/Dialog.tsx | Accessible modal/drawer, Escape and Tab handling, focus restoration, and background scroll locking |
| frontend/src/components/QuickActions.tsx | Working New client action; disabled, clearly labeled future deal/invoice actions |
| frontend/src/features/auth/ | Sign-in form |
| frontend/src/features/clients/api.ts | Client DTOs and list/detail/create/update/delete requests |
| frontend/src/features/clients/ClientsPage.tsx | Shared company client list, submitted search, pagination, refresh, and mutation coordination |
| frontend/src/features/clients/ClientForm.tsx | Create/edit form, writable-field selection, validation, pending state, and server field errors |
| frontend/src/features/clients/ClientDetails.tsx | Contact drawer, real related deals, and explicit notes/links placeholders |
| frontend/src/features/clients/DeleteClientDialog.tsx | Delete confirmation and protected-record feedback |
| frontend/src/styles/index.css | Shared surface/text/border/accent tokens, 8px spacing unit, component states, themes, and mobile client cards |
| frontend/tests/ | Vitest and Testing Library coverage for authentication, API handling, client interactions, and account changes |
| tests/ | Reserved cross-module and full business-flow E2E scenarios |
| docs/ | API, schema, access, architecture, setup, and implementation status |
| security/ | Access policies and security checks |

Navigation uses hashes such as `#/clients` and `#/settings`, preserving the selected section on reload without adding a routing dependency. The Clients page is keyed by the authenticated user so switching accounts resets all client state. List and detail requests are aborted when their view changes; outdated responses are ignored.

Search is submitted explicitly instead of requesting on every keystroke. Mutations use the existing API client and refetch the server list after success. No browser-local client database, workspace selection, invitation flow, or role matrix is introduced.
