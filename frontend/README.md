# Frontend

React, TypeScript and Vite. Installation and local startup are in the [root README](../README.md).

## Structure

- src/app/: application shell, session restoration and navigation.
- src/api/client.ts: shared session/CSRF client and account API.
- src/features/: auth, clients, deals, tasks, invoices, activity, operations, dashboard and design preview. Each feature keeps its pages, API calls and styles together. The preview shell in VisualWorkspace.tsx delegates page content to PreviewDashboard, PreviewDeals, PreviewClients, PreviewInvoices and PreviewSettings; PreviewEditor owns its local forms and document preview.
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

Account routes are /login, /sign-up, /verify-email, /resend-verification, /forgot-password, /reset-password and /oauth-result. Password registration shows a neutral message and waits for the user to confirm the emailed link before opening the workspace. The verification page requires a button click so email link scanners do not consume the token on page load. Workspace sections use /#/clients, /#/deals, /#/tasks, /#/invoices, /#/activity, /#/operations, /#/dashboard and /#/settings. System, light and dark themes are available in account settings. The selected section survives reload. Tasks, Deals, Clients and Invoices appear in the top navigation; Dashboard, Activity, Operations and Settings are in the side navigation. On narrow screens the top navigation remains horizontally scrollable so Tasks stays reachable.

Business pages use real workspace data. Forms preserve rejected drafts, wait for server confirmation and refresh saved records. Deal changes send the observed version and surface stale-edit conflicts. Invoice amounts and analytics come from the backend; PDF download and browser print are available for live invoices.

Tasks shows personal and team actions, overdue and upcoming work, and completed tasks. Its compact workspace view has a top search, client/deal filters, list actions and a side editor. Each task has a client, optional deal, title, workspace assignee, local due time and Open/Done state. Members can create tasks for teammates and update assignments; saved changes appear after a new request. The Dashboard shows the current user's next five open tasks. Links open the related client or deal. Removing a member leaves their tasks in the workspace as unassigned. There are no automatic task emails or background reminders yet.

Activity shows recent workspace changes with their author and time. It can filter client, deal, task and invoice events, and links to available records. It begins recording after the activity migration; existing records do not gain invented history. Notes are visible only in their client details and are not mixed into Activity.

Operations shows Today and Reminders. Today combines the current user's open tasks with sent invoice and active deal deadlines due within seven days or already overdue. A task can be completed directly there. Reminders shows the workspace's due invoices and deals; an overdue invoice can open its email preview before a member explicitly sends it. Activity remains a separate page linked from Operations. The overview shows at most 20 earliest records per view and the total count. Automatic reminders and an Automations screen are not available because no verified job scheduler is configured; the page does not imply that email delivery works without SMTP.

Settings → Workspace keeps seller bank details hidden until the owner chooses Reveal payment details. The backend requires a recent identity confirmation for viewing or saving them. The client form can save optional payer bank details for that client. New invoices copy both into their saved snapshots and show them in the document view and PDF for workspace members. Updating bank details later does not rewrite existing invoices.

Settings → Workspace also lets the owner reveal and save a default seller profile: name, business email, phone, address and tax ID. New invoice drafts use that profile automatically on creation. An existing draft can still be edited before issue. Members cannot open the saved profile in Settings; seller details already copied into an invoice remain visible to members who can view that invoice. Updating the profile does not rewrite earlier invoices or PDFs.

The Invoices page shows due dates, overdue balances, received payments and email attempts in the invoice details. Drafts can be edited before issue. Sending a PDF requires confirmation and a configured mail server; the UI distinguishes mail server acceptance from inbox delivery. Overdue reminders show their exact text before the user sends them. Payments are entered only after receipt has been confirmed outside the app. Cancellation requires a reason and is unavailable after any recorded payment.

Settings → Profile lets a user change their username and upload or remove a profile photo. Settings → Workspace lists members, allows any member to rename the workspace, and lets its owner add an existing account by username after confirming their identity in Security. The existing account must have an empty personal workspace. The owner can remove another member after the same identity check and an explicit confirmation; the former member gets an empty personal workspace and loses access to the company's records. Email invitations are not available. A colleague sees workspace changes after a new request or refresh.

The invoice editor supports the currencies accepted by the Invoice API, including GBP and PLN. The currency selector filters both the invoice table and original-currency summary cards; it does not convert document totals. Deals shows per-stage and pipeline totals for the selected currency and keeps individual cards in their original currency.

Dashboard combines supported original currencies using stored ECB reference rates and displays USD, EUR, GBP, PLN, AUD, CAD, CHF or JPY. The reporting currency is saved per user and can also be changed in Settings → Appearance. An affected total is hidden when a required rate is missing; original deal and invoice amounts remain visible in their own currencies.

The authenticated /preview#/deals route is a design playground. It reads a separate workspace PreviewDataset; workspaces without one show an unavailable state. Preview edits remain in memory and reset on reload. Preview drag-and-drop and document export are not connected. Preview records do not write to live business tables.

Keep credentials server-side in the ignored root .env. Browser requests use same-origin cookies and CSRF; the client does not store authentication tokens in localStorage or automatically retry writes. Verify responsive navigation, keyboard focus, provider consent and printing in a browser when changing those flows.
