# Security controls

- [x] Django handles user passwords; the session cookie uses HttpOnly.
- [x] Login requires CSRF before authentication; logout requires a session and CSRF.
- [x] Tests cover untrusted Origin, invalid and missing CSRF, token rotation, and session termination.
- [x] Actual Clients API scopes list/search/detail/mutations by workspace: colleagues share access, another company receives 404, anonymous requests receive 403.
- [x] Database constraints enforce one workspace membership per user and unique workspace/user pairs.
- [x] New users receive a workspace; existing admin and business records are migrated without resets.
- [x] Workspace/creator and unknown request fields are rejected; membership cannot be edited through an API.
- [x] Missing membership fails closed; local employee assignment refuses moves from workspaces with business records.
- [x] Client writes lock membership within transactions against concurrent local reassignment.
- [x] Model validation rejects cross-workspace relationships; nonnegative amounts and deletion protection are tested.
- [x] Protected client deletion returns controlled 409 and preserves invoices and history.
- [x] Migration tests preserve populated legacy models and reject inconsistent legacy relationships.
- [x] `.env`, environments, caches, and logs are excluded from Git.
- [x] Nested notes/links resolve the workspace-scoped parent before reading or validating writes; foreign parents return 404.
- [x] Note authors and timestamps are server-controlled; identity injection, unsafe URL schemes, and plain-text XSS rendering are tested.
- [ ] Workspace-scoped Deals and Invoices APIs; Clients CRUD and notes/links are implemented.
- [ ] Atomic version/409 transitions, financial services, and snapshot immutability — respective modules.
- [ ] HTTPS, Secure cookies, rate limiting, production settings, and backups — before deployment.
