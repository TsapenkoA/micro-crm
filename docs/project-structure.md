# Project structure

| Path | Responsibility |
| --- | --- |
| backend/config/ | Django settings, root API routes, ASGI and WSGI entry points |
| backend/apps/accounts/ | Sessions, workspace membership, user provisioning, and local employee assignment |
| backend/apps/clients/ | Client models, scoped CRUD, search, pagination, nested notes/links, and read-only related deals |
| backend/apps/deals/ | Deal model and database constraints; no Deals CRUD endpoint yet |
| backend/apps/invoices/ | Invoice/item models and constraints; no invoice editor or PDF endpoint yet |
| backend/apps/analytics/ | Reserved for financial aggregation |
| backend/common/ | Shared validation, workspace permissions, health checks, and API errors |
| backend/tests/ | PostgreSQL integration, model, authentication, workspace, and migration tests |
| frontend/src/app/App.tsx | Existing sidebar layout, hash navigation, session restoration, theme selection, and global quick actions |
| frontend/src/api/client.ts | Shared typed fetch, session cookies, CSRF acquisition, and normalized API/network errors |
| frontend/src/components/Dialog.tsx | Accessible modal/drawer, Escape and Tab handling, focus restoration, and background scroll locking |
| frontend/src/components/QuickActions.tsx | Working New client action; disabled, clearly labeled future deal/invoice actions |
| frontend/src/components/ThemeSelect.tsx | System/Light/Dark preference, persistence, and system appearance changes |
| frontend/src/components/NavIcon.tsx | Shared navigation icons |
| frontend/src/features/auth/ | Sign-in form |
| frontend/src/features/clients/api.ts | Client and history DTOs, CRUD requests, and nested notes/links reads and writes |
| frontend/src/features/clients/ClientsPage.tsx | Shared company client list, submitted search, pagination, refresh, and mutation coordination |
| frontend/src/features/clients/ClientForm.tsx | Create/edit form, writable-field selection, validation, pending state, and server field errors |
| frontend/src/features/clients/ClientDetails.tsx | Contact drawer, real related deals, and shared client history |
| frontend/src/features/clients/ClientHistory.tsx | Note timeline, link list, paginated refresh, safe rendering, forms, and field errors |
| frontend/src/features/clients/DeleteClientDialog.tsx | Delete confirmation and protected-record feedback |
| frontend/src/styles/index.css | Shared color/status, spacing, typography, radius and shadow tokens; component states, themes, responsive navigation and client cards |
| frontend/tests/ | Vitest and Testing Library coverage for authentication, API handling, client interactions, and account changes |
| tests/ | Reserved cross-module and full business-flow E2E scenarios |
| docs/ | API, schema, access, architecture, setup, and implementation status |
| security/ | Access policies and security checks |

Navigation uses hashes such as `#/clients` and `#/settings`, preserving the selected section on reload without adding a routing dependency. The Clients page is keyed by the authenticated user so switching accounts resets all client state. List and detail requests are aborted when their view changes; outdated responses are ignored.

Search is submitted explicitly instead of requesting on every keystroke. Mutations use the existing API client and refetch the server list after success. No browser-local client database, workspace selection, invitation flow, or role matrix is introduced.

The sidebar displays the signed-in user's workspace name and collapses behind an Open menu button below 768px. Selecting a section or pressing Escape closes it and returns focus to the toggle. Skip to content focuses the main region without changing the hash route. Client rows become cards below 1024px to accommodate the desktop sidebar at tablet widths; drawers fit the viewport.

Theme selection defaults to System and persists in localStorage. The inline bootstrap in index.html resolves the preference before the first stylesheet/application render; ThemeSelect follows operating-system changes only in System mode. Both sign-in and the application use the same control. Color tokens include page/surface/raised surfaces, text, separators, control borders, accent, success, warning and danger. Spacing tokens cover 4/8/12/16/24/32/48px; shared component styles consume named spacing, typography, radius and shadow tokens.
