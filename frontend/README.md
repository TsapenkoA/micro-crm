# Frontend

React, TypeScript and Vite. See the [root README](../README.md) for setup and startup.

## Structure

- `src/app`: application shell, session restoration and navigation.
- `src/api/client.ts`: same-origin session/CSRF client and account API.
- `src/features`: auth, clients, deals, tasks, invoices, dashboard, activity, operations and preview; each owns its components, API calls and styles.
- `src/components`, `src/utils`, `src/styles`: shared controls, dates and design styles.
- `tests`: component flows and API-client contracts. TypeScript checks application and test files, including unused imports/parameters.

```powershell
npm.cmd test -- --maxWorkers=2
npm.cmd run build
```

Vite proxies `/api` to Django; browser requests retain the frontend origin and session cookies. Writes use CSRF and are not automatically retried. Credentials remain server-side; authentication tokens are not stored in localStorage. Keep browser CSP in `index.html` and Vite's development-only policy consistent with [backend security requirements](../backend/SECURITY.md).

The authenticated `/preview` reads a separate workspace dataset. Its edits reset on reload; exports and preview drag-and-drop are not connected to live records. It must not be used to verify persisted business changes.

Use a browser to verify responsive navigation, keyboard focus, OAuth consent and printing when changing those flows. Component tests cannot establish visual fidelity or real provider/email delivery.
