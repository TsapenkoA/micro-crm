# Authentication and workspace access

Authentication remains Django Sessions with DRF SessionAuthentication. Password hashing and session storage use Django. The sign-in identifier is username; email is not unique. Existing frontend login/logout/me response shapes are unchanged.

1. GET /api/v1/auth/csrf returns a masked csrfToken and sets csrftoken.
2. POST /api/v1/auth/login sends username/password, cookies, and X-CSRFToken. Login is explicitly CSRF-protected for anonymous users.
3. Successful login establishes an HttpOnly sessionid cookie and rotates CSRF. Use the returned csrfToken for writes.
4. GET /api/v1/auth/me returns the authenticated user. POST /api/v1/auth/logout requires the session and current CSRF token, then deletes the server-side session.

Cookies use SameSite=Lax. Local HTTP does not use Secure; production HTTPS/cookie settings remain a deployment task. Vite proxies /api to preserve one origin. Untrusted Origin and missing/invalid CSRF are rejected.

## Company membership

Normal Django user creation triggers workspace provisioning. Each existing user, including admin, receives a workspace during migration. A OneToOne user relationship and unique workspace/user constraint prevent multiple memberships. Missing membership denies Clients API access with 403; the API never provisions a workspace or joins a company from request input.

Clients API checks membership centrally in IsWorkspaceMember, then WorkspaceQuerysetMixin scopes the queryset before any search or object lookup. Object permissions verify the same workspace. Superuser status does not bypass this company boundary. Client writes lock and recheck membership inside a transaction to prevent a concurrent local assignment from changing its scope.

Only a trusted local operator may use `uv run python manage.py assign_workspace <username> <workspace-uuid>` (replace both placeholders). It accepts existing users and workspaces, allows an empty-source move, and refuses moves from a workspace with business data. There is no public membership, invitation, or workspace transfer endpoint. See README for creating a regular employee without granting superuser status.

Bulk user insertion and raw fixture loading bypass provisioning; explicitly assign membership before use. No public registration or recovery flow is implemented. Login throttling and production hardening require separate configuration before deployment.
