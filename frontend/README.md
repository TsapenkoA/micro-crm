# Frontend

React, TypeScript and Vite. Installation and local startup are in the [root README](../README.md).

## Structure

- src/app/: application shell, session restoration and navigation.
- src/api/client.ts: shared session/CSRF client and account API.
- src/features/: auth, clients, deals, invoices, dashboard and design preview. Each feature keeps its pages, API calls and styles together. The preview shell in VisualWorkspace.tsx delegates page content to PreviewDashboard, PreviewDeals, PreviewClients, PreviewInvoices and PreviewSettings; PreviewEditor owns its local forms and document preview.
- src/components/: shared dialogs, navigation icons, quick actions and theme controls.
- src/styles/: global styles.
- tests/: UI workflows and shared API-client checks.

## Development

```powershell
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

Vite runs at http://127.0.0.1:5173 and proxies /api to Django at http://127.0.0.1:8000. The build includes TypeScript checking; npm.cmd run typecheck runs it separately. Django does not serve the frontend build.

Account routes are /login, /sign-up, /forgot-password, /reset-password and /oauth-result. Workspace sections use /#/clients, /#/deals, /#/invoices, /#/dashboard and /#/settings. System, light and dark themes are available in account settings. The selected section survives reload.

Business pages use real workspace data. Forms preserve rejected drafts, wait for server confirmation and refresh saved records. Deal changes send the observed version and surface stale-edit conflicts. Invoice amounts and analytics come from the backend; PDF download and browser print are available for live invoices.

Settings → Workspace keeps seller bank details hidden until the owner chooses Reveal payment details. The backend requires a recent identity confirmation for viewing or saving them. The client form can save optional payer bank details for that client. New invoices copy both into their saved snapshots and show them in the document view and PDF for workspace members. Updating bank details later does not rewrite existing invoices.

Settings → Profile lets a user change their username and upload or remove a profile photo. Settings → Workspace lists members, allows any member to rename the workspace, and lets its owner add an existing account by username after confirming their identity in Security. The existing account must have an empty personal workspace. Member removal and email invitations are not available. A colleague sees workspace changes after a new request or refresh.

The invoice editor supports the currencies accepted by the Invoice API, including GBP and PLN. The currency selector filters both the invoice table and original-currency summary cards; it does not convert document totals. Deals shows per-stage and pipeline totals for the selected currency and keeps individual cards in their original currency.

Dashboard combines supported original currencies using stored ECB reference rates and displays USD, EUR, GBP, PLN, AUD, CAD, CHF or JPY. The reporting currency is saved per user and can also be changed in Settings → Appearance. An affected total is hidden when a required rate is missing; original deal and invoice amounts remain visible in their own currencies.

The authenticated /preview#/deals route is a design playground. It reads a separate workspace PreviewDataset; workspaces without one show an unavailable state. Preview edits remain in memory and reset on reload. Preview drag-and-drop and document export are not connected. Preview records do not write to live business tables.

Keep credentials server-side in the ignored root .env. Browser requests use same-origin cookies and CSRF; the client does not store authentication tokens in localStorage or automatically retry writes. Verify responsive navigation, keyboard focus, provider consent and printing in a browser when changing those flows.
