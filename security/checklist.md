# Current phase controls

- [x] Django handles user passwords; the session cookie uses HttpOnly.
- [x] Login requires CSRF before authentication; logout requires a session and CSRF.
- [x] Tests cover untrusted Origin, invalid and missing CSRF, token rotation, and session termination.
- [x] Owner filtering is verified using a test DRF view: own object 200, another owner's object 404, anonymous request 403.
- [x] Model validation rejects cross-owner relationships; nonnegative amounts and deletion protection are tested.
- [x] `.env`, environments, caches, and logs are excluded from Git.
- [ ] Owner-scoped CRUD and incoming relationship validation in actual business APIs — later days.
- [ ] Atomic version/409 transitions, financial services, and snapshot immutability — respective modules.
- [ ] HTTPS, Secure cookies, rate limiting, production settings, and backups — before deployment.
