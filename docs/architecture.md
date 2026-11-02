# Architecture

Browser → React + TypeScript → Vite proxy `/api` → Django 5.2 / DRF → PostgreSQL 18. Two development processes share one application database. Django provides the ORM, migrations, password hashing, sessions, and CSRF protection.

`backend/config/settings/` contains shared, local, and test settings; tests also use PostgreSQL. `backend/apps/` contains accounts, clients, deals, invoices, and analytics. `backend/common/` contains error handling, health checks, and basic ownership checks. The repository follows the detailed tree in section 13.2 of the technical plan.

Client, ClientNote, ClientLink, Deal, Invoice, and InvoiceItem use UUIDs. Client, Deal, and Invoice have explicit owners. Child objects inherit ownership through their parent records. A note's author must own its client. Amounts use NUMERIC/Decimal, and dates use timezone-aware UTC values. Related records use PROTECT until explicit deletion services are implemented.

This phase provides health and authentication APIs, a sign-in form, and Dashboard / Deals / Clients / Invoices / Settings navigation. CRM sections display placeholders. CRUD, optimistic locking for deals, server-side invoice calculations, automatic paid_at updates, PDF, analytics, themes, and full business-flow E2E tests belong to later days. Documentation, interface copy, and application messages use English.

Migrations enforce field and status constraints, nonnegative amounts, invoice_number uniqueness per owner, and consistency between status and paid_at. Cross-owner relationship checks run during regular model.save() calls. Future write services must use owner-scoped querysets and transactions. QuerySet.update(), bulk_create(), and direct SQL bypass model validation and must not be used to change ownership or relationships. Child resource querysets must filter through the parent object's owner.
