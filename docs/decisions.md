# Decisions and clarifications

- The detailed tree in section 13.2 refines the shorter tree in section 3: Django modules live in `backend/apps/`.
- Sign-in uses the standard Django User's username and password. Email is not unique and is not a login identifier. Registration and password recovery are outside Days 1–2.
- Accounts are private, without shared workspaces or team roles. An agency's potential need for shared access remains a product risk until confirmed.
- The original requirements show money as JSON numbers; the technical plan specifies Decimal strings. Future financial APIs must return strings without using JavaScript Number for calculations.
- Initial models use 2 decimal places for amounts, 3 for quantity, and 4 for tax_rate. Currency codes are validated as three uppercase Latin letters; the ISO code registry and support for currencies with different decimal precision need clarification before financial services are implemented. Amounts in different currencies must not be combined.
- Archived does not automatically mean lost. Outcome supports none/lost/cancelled and may differ from none only for archived deals. Paid requires paid_at; initial models validate this, while automatic timestamps belong to status transition services.
- Invoice stores buyer_snapshot/seller_snapshot and monetary totals. Snapshot creation, item calculations, rounding, and protection against changes to historical data will be implemented with the invoice module. Financial writes are not available through the API until then.
- Revenue from paid invoices, Win Rate based on paid and archived/lost deals, tax rules, and the legal invoice format remain assumptions in the technical plan. Confirm them before their respective modules; they do not block the Day 1–2 foundation.
- The existing PostgreSQL cluster is used without reinstallation or reinitialization. Separate micro_crm and test_micro_crm databases isolate application and test tables. The application role has no superuser/CREATEDB/CREATEROLE privileges; an administrator precreates the test database, and pytest preserves it between runs.
- The security directory contains policies and checks rather than duplicating Django permissions. Root-level tests/ is reserved for future end-to-end and cross-module scenarios; current tests live in backend/tests/ and frontend/tests/.
