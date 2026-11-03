# Security

Primary threats include access to another account's records, forged requests from an external site, secret exposure, invalid financial data, and accidental deletion of historical records.

All DRF APIs require SessionAuthentication and IsAuthenticated by default. CSRF and login are exceptions; health separately exposes only connection status. Login explicitly uses csrf_protect because standard DRF CSRF validation is insufficient for anonymous users. Logout requires POST with a session and CSRF token. Login rotates tokens, and logout deletes the server-side session.

IsWorkspaceMember resolves membership from the database, and WorkspaceQuerysetMixin filters by the resulting workspace before list, search, pagination, or object lookup. Object permissions verify the workspace again. Another company's objects return 404, including mutation attempts. Membership is required even for superusers. Object permissions do not replace queryset filtering. Client writes lock membership in their transaction, serializing against the trusted assignment command.

Client input accepts only name/company/email/phone. Workspace, creator, IDs, timestamps, and unknown input fields are rejected. The server assigns workspace and creator. No API allows joining or choosing a company. The local assign_workspace command requires trusted shell/database access and refuses moves from a workspace with business data. Missing membership fails closed. New users receive workspaces through normal Django saves; bulk/raw imports require explicit provisioning.

Models verify that clients and their deals/invoices share a workspace and that creators/note authors are workspace members. Workspace and creator are immutable after creation. These are application checks, not cross-table database triggers. Bulk/update operations and direct SQL bypass them and must not change ownership or relationships. Child notes/links inherit Client's workspace; items inherit Invoice's workspace. Future child APIs must use those scoped parents.

Client deletion catches PROTECT failures and returns a controlled 409 without disclosing related record IDs. Financial documents, deals, notes, and links are preserved. Migration uses historical models, validates legacy ownership, and backfills a separate workspace per existing account without merging companies. Back up before upgrading; the data migration has no automatic reverse operation.

Secrets stay in the local `.env`, and dependencies are pinned in lock files. Tests use a separate database; the application role has no global administrative privileges. DEBUG and HTTP cookies are intended for local development. Production deployment requires HTTPS, Secure cookies, a reverse proxy, rate limiting, and backups.
