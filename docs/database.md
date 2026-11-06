# Database

## Authentication storage

accounts/0003_authattempt adds rate-limit buckets: hashed key (primary key), window_start and attempts. Row locks share limits across workers. clear_auth_attempts removes buckets older than one day.

django-allauth account/socialaccount migrations add provider identity/email/configuration tables. SocialAccount uniquely identifies a provider/UID pair. Provider access tokens are not retained; app credentials come from environment settings. Built-in User and business schemas are not replaced. Legacy duplicate emails remain unchanged and cannot be used for ambiguous email login/reset.

Public password/social signup wraps user/workspace/membership/provider registration in transactions and serializes creation by normalized email with a PostgreSQL advisory lock. This is an application invariant, not a new auth_user.email uniqueness constraint. Trusted imports must avoid duplicate identities. Reset and method removal lock the user to prevent token reuse/final-method races.

Auth migration was preceded by a custom-format PostgreSQL backup in ignored .local. Before/after comparison preserved all fields of two existing users, two workspaces/memberships, one client, two notes and two links; no deals/invoices existed. Existing records were not reset or reassigned.

## Business data

PostgreSQL 18 is used for development and integration tests. Django migrations are the schema source of truth. All domain IDs are UUIDs; the built-in Django User retains its standard integer primary key. Timestamps are timezone-aware UTC.

| Model | Ownership and important fields |
| --- | --- |
| Workspace | name (200), created_at, updated_at |
| WorkspaceMembership | workspace FK, user OneToOne, created_at; unique (workspace, user) |
| Client | workspace FK, created_by User FK, name (200, required), company (200, optional), email (254, optional), phone (50, optional), created_at, updated_at |
| ClientNote | client FK, author User FK, text, created_at; workspace inherited through client |
| ClientLink | client FK, label, url, created_at; workspace inherited through client |
| Deal | workspace FK, created_by User FK, client FK, title, status, amount, currency, deadline, version, outcome, paid_at, timestamps |
| Invoice | workspace FK, created_by User FK, client FK, invoice_number, currency, legacy tax_rate, status, issued_at, paid_at, created_at, updated_at, seller/buyer snapshots, subtotal, tax_total, total_amount |
| InvoiceItem | invoice FK, position, description, quantity, unit_price, tax_rate, line_total, tax_amount; workspace inherited through invoice |

Deal amounts use Decimal/NUMERIC with 2 decimal places. Invoice amounts and unit prices store up to 4 decimal places; item quantity uses 3 and item tax_rate uses 4. New invoice values are rounded to the supported currency's minor unit before saving. Item quantity must be positive, prices and amounts nonnegative, and item tax_rate between 0 and 100. Invoice numbers are unique per workspace. The invoice-level tax_rate is retained for historical compatibility; new calculations use each item's rate.

Invoices migrations 0004 and 0005 add issued_at, updated_at, item position/rate/tax and widen financial precision. Historical totals, numbers, snapshots and relationships are not recalculated or deleted. Migration 0004 copies created_at to updated_at and the legacy invoice tax rate to each existing item; it computes historical item tax without altering stored invoice totals. Migration 0005 makes updated_at required and replaces the item-value constraint. Invalid historical quantity/rate stops the migration for review, preserving the source data.

Client/Deal/Invoice workspace and creator are immutable during normal model saves. Their creators must be workspace members. Deal and Invoice must reference a client of the same workspace. A note author must belong to the client's workspace, so colleagues may write notes on shared clients. These cross-table checks are application validation, not database triggers. Bulk writes and direct SQL bypass them and must not be used for relationship changes.

All business relationships use PROTECT to avoid uncontrolled deletion. Membership's user relation uses CASCADE when an otherwise unreferenced user is deleted; membership's workspace uses PROTECT. Referenced creators and authors are protected. Empty workspaces are retained after employee assignment.

The Deals API reuses the existing schema; no new migration or data rewrite is needed. Scoped validation, locked membership/client checks and existing database constraints protect API relationships. Its update path intentionally uses QuerySet.update() only for whitelisted business fields, paid_at, updated_at and an atomic version increment, with direct id/workspace/version predicates. It never updates workspace or creator. All status transitions are allowed; leaving paid clears paid_at, and leaving archived resets outcome. Deal amounts retain the existing two-decimal schema independently of invoice calculations. See the API contract for supported currency codes and concurrency behavior.

Notes and links reuse their existing tables without a new schema migration. Note creation accepts nonblank text up to 10,000 characters through the API; author and created_at are server-controlled. Link validation requires http/https at both serializer and normal model-save levels. Stored legacy non-http links are not rewritten; the UI displays them without an active anchor. Authors may explicitly delete their own notes; the operation locks membership, client, and note, and removes only that note. Note editing and link editing/deletion are not exposed. Clients with remaining notes or links remain protected. The response's can_delete flag is computed per request and is not a stored database field.

## Upgrade from personal ownership

1. Stop application writes and back up the existing database.
2. accounts/0001 creates Workspace and WorkspaceMembership.
3. clients/deals/invoices/0002 rename owner to created_by and add nullable workspace. The old invoice owner/number uniqueness constraint is removed before replacement.
4. accounts/0002 checks legacy client/creator and note/author relationships, creates a distinct workspace and membership for each existing user, and backfills root records. Child references remain unchanged. Invalid relationships stop this atomic data migration before business values are changed.
5. clients/deals/invoices/0003 require workspace; invoices/0003 adds workspace/number uniqueness.
6. invoices/0004 adds item-level tax and monetary precision, backfills legacy invoice tax rates and item positions, and preserves existing invoice totals. invoices/0005 applies the new field and item constraints.

Run `uv run python manage.py migrate` from backend. Do not edit applied migrations or reinitialize PostgreSQL. If integrity validation fails, stop and investigate the reported relationship category before continuing; earlier schema steps may already have committed, but original field values remain preserved. Do not use the app with a partially applied upgrade.

The data step is intentionally irreversible. After shared data exists, there is no safe general reverse mapping to private accounts. Recovery requires the pre-upgrade backup or a separately reviewed forward migration.

Migration tests verify preservation of existing users and populated Client, ClientNote, ClientLink, Deal, Invoice, and InvoiceItem records through the full migration chain, including IDs, field values, timestamps, snapshots, and references. They also verify that inconsistent legacy ownership stops the data migration without changing business values.
