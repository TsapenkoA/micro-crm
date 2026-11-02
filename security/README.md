# Security

Primary threats include access to another account's records, forged requests from an external site, secret exposure, invalid financial data, and accidental deletion of historical records.

All DRF APIs require SessionAuthentication and IsAuthenticated by default. CSRF and login are exceptions; health separately exposes only connection status. Login explicitly uses csrf_protect because standard DRF CSRF validation is insufficient for anonymous users. Logout requires POST with a session and CSRF token. Login rotates tokens, and logout deletes the server-side session.

OwnerQuerysetMixin and owned_object_or_404 filter records by request.user; IsOwner provides an additional object permission check. Object permissions do not replace list filtering. Child notes, links, and invoice items must be accessed through their owner-scoped parent resources. Owner/author must not be accepted from client JSON; future APIs must set them from request.user.

Models verify that clients and their deals/invoices share an owner and that a note's author owns its client. This is application validation, not a cross-table PostgreSQL CHECK. Bulk/update operations and direct SQL carry separate risks and must not be used to change ownership. Services added in later days must preserve these invariants within transactions.

Secrets stay in the local `.env`, and dependencies are pinned in lock files. Tests use a separate database; the application role has no global administrative privileges. DEBUG and HTTP cookies are intended for local development. Production HTTPS, Secure cookies, a reverse proxy, rate limiting, and backups belong to a separate deployment phase.
