# Authentication and workspace access

Django Sessions and DRF SessionAuthentication remain the authentication mechanism. Django hashes and validates passwords; no JWT or browser token store is introduced. Auth screens use the shared System/Light/Dark theme without the workspace sidebar.

## Sign-in and registration

Frontend routes are /login, /sign-up, /forgot-password, /reset-password and /oauth-result. Business sections retain hash routes such as /#/clients. An expired session clears the visible account state and returns to sign-in while retaining the selected business section. CSRF and permission failures do not automatically log out a valid user. Return navigation stays local.

Login accepts email or a legacy username, including admin. Email lookup is case-insensitive and requires exactly one match. Legacy duplicate emails are not merged or rewritten: use distinct usernames until a trusted operator resolves them. Invalid/inactive credentials return the same controlled 403.

Registration requires username, email, password and password_confirm. Username is chosen by the user, not generated as a UUID. It has a 150-character limit, uses Django's Unicode username validation and excludes @. Case-insensitive uniqueness is rechecked under a username-scoped advisory lock. User, personal Workspace and Membership are created in one transaction; email-scoped locks also serialize duplicate email claims. Existing primary/social email addresses cannot be claimed. Users sign in with email or their chosen username. Password signup does not verify email ownership and does not claim otherwise. Matching email domains never assign company membership.

Settings → Account → Profile allows existing users to replace technical usernames. PATCH /api/v1/auth/profile accepts only username and requires a session/CSRF. It updates the existing user rather than creating another account, preserves IDs/notes/clients/sessions, and refreshes the sidebar immediately. The old automatically generated personal workspace name is updated only for a single-member workspace; custom names and shared companies remain unchanged. Existing nicknames are not bulk-renamed.

## Sessions and CSRF

1. GET /api/v1/auth/csrf returns a masked csrfToken and sets csrftoken.
2. Unsafe requests include cookies and X-CSRFToken. Login, signup, forgot/reset and OAuth initiation explicitly require CSRF before authentication.
3. Login/signup establishes the session, rotates CSRF and returns user plus csrfToken. user includes the read-only workspace id/name, or null without membership.
4. GET /api/v1/auth/me restores the session; POST /api/v1/auth/logout invalidates it.

Session cookies use HttpOnly and SameSite=Lax. Secure is disabled for local HTTP. Vite proxies /api to preserve one origin; use a consistent hostname. The shared client lazily obtains CSRF, clears its cached token after 403, and never automatically retries writes. Forms support autocomplete, password visibility, Enter submission and disabled pending states.

## Password reset and changes

Forgot password returns the same 202 message for validly formatted email, including unknown, inactive, ambiguous and social-only accounts. Only an active user with a usable password and unique email receives instructions. Mail failures are logged without transport details and do not change the public response. A 202 response is not proof of delivery.

Django reset tokens expire after one hour. Reset locks the user, checks the token and password validators, then changes the password atomically. Tokens cannot be reused; previous sessions fail authentication and the requesting session is cleared. The reset page removes token query parameters after success and uses a no-referrer policy. Tokens are not stored in localStorage.

Settings lists sign-in methods. Changing a usable password requires the current password; setting the first password on a social-only account requires a sign-in within five minutes. Password changes preserve the current session and invalidate other sessions.

## Social providers

Google, GitHub and Microsoft use django-allauth server-side authorization-code callbacks with session-bound, single-use state and PKCE. Tokens are exchanged on the server and are not retained for later provider API access. Stable provider/account identifiers identify returning users. First social signup is transactional with workspace provisioning. Automatic email authentication/connection is disabled.

Email collisions return to the auth result screen: sign in to the existing account and explicitly connect in Settings. Connecting/disconnecting requires an authenticated, recently verified session. Password users can confirm their password; social-only users sign in again with a connected provider. A provider owned by another account cannot be reassigned. Disconnect locks the user and refuses to remove the last usable method. The UI asks for confirmation; server checks apply independently.

Both provider CLIENT_ID and CLIENT_SECRET must exist before its button is enabled. Otherwise it displays Not configured. Secrets stay server-side in the ignored .env. Callback/error redirects use a fixed frontend URL; arbitrary next URLs are discarded.

Google, GitHub and Microsoft credentials are configured in the current local .env. Running provider metadata reports configured=true for all three. Their real start endpoints were checked for the configured client, exact callback URI, state and PKCE; GitHub requests user:email and Microsoft requests User.Read through the common tenant endpoint. Completing external consent/sign-in remains a manual acceptance step. Microsoft App Registration must allow both organizational and personal accounts to match common. If Google OAuth is in testing mode, the Google account must be allowed under the Cloud project's Audience → Test users. An email already registered locally must connect the provider from Settings after signing in, rather than create a duplicate account.

### Local OAuth apps

Set FRONTEND_URL=http://127.0.0.1:5173. Register these exact Web application redirect URIs:

| Provider | Environment variables | Local redirect URI | Scopes |
| --- | --- | --- | --- |
| Google | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | http://127.0.0.1:5173/api/v1/auth/oauth/google/callback/ | openid, email, profile |
| GitHub | GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET | http://127.0.0.1:5173/api/v1/auth/oauth/github/callback/ | user:email |
| Microsoft | MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT | http://127.0.0.1:5173/api/v1/auth/oauth/microsoft/callback/ | User.Read |

Create a Google OAuth Web application and configure its consent screen/test users. Create a GitHub OAuth App with the local frontend Homepage URL. Register a Microsoft Entra Web application and choose account types matching MICROSOFT_TENANT (common by default). Set credentials in .env and restart Django. Never expose client secrets through frontend environment variables. Callback trailing slashes are required. Vite preserves the browser Host; production needs equivalent routing on the public HTTPS origin.

References: [provider configuration](https://docs.allauth.org/en/latest/socialaccount/provider_configuration.html), [Google](https://docs.allauth.org/en/latest/socialaccount/providers/google.html), [GitHub](https://docs.allauth.org/en/latest/socialaccount/providers/github.html), [Microsoft](https://docs.allauth.org/en/latest/socialaccount/providers/microsoft.html). Mocked callbacks do not establish live-provider readiness.

## Email configuration

Local development defaults to Django's console backend: reset messages appear in the backend terminal, not an inbox. Tests use the in-memory backend. Do not share reset links from development output.

Production uses config.settings.production and EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend. Configure EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, EMAIL_USE_TLS and DEFAULT_FROM_EMAIL, plus an HTTPS FRONTEND_URL. That module requires SMTP/EMAIL_HOST and enables Secure session/CSRF cookies and HTTPS redirects. SMTP delivery, hosting and proxy configuration have not been deployed or verified here.

## Rate limits

PostgreSQL-backed counters apply per REMOTE_ADDR and, where supplied, normalized sign-in identifier. Atomic row locks share limits across workers; forwarded client IP headers are not trusted. Limits: 10 login attempts/5 minutes, 5 signups/hour, 5 reset requests/hour, 10 reset submissions/5 minutes, 10 security writes/5 minutes, 20 OAuth starts/5 minutes. Rejections use the standard 429 envelope and Retry-After. Bucket keys are SHA-256 hashes rather than plaintext identifiers/IPs. Deployment behind a proxy needs environment-specific trusted proxy/network limits.

Periodically remove buckets older than one day from backend:

```powershell
uv run python manage.py clear_auth_attempts
```

## Company membership

Normal Django user creation provisions a workspace; public password/social signup wraps provisioning in the user transaction. Database constraints allow one membership per user. Missing membership denies Clients access with 403. No public API selects a company or changes membership. Trusted operators can use `uv run python manage.py assign_workspace <username> <workspace-uuid>`; populated source workspaces cannot be moved. Bulk imports/raw fixtures still need explicit membership provisioning.

Clients querysets/object permissions enforce company isolation without a superuser bypass. These rules are unchanged by new sign-in methods.
