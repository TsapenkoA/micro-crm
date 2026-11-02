# End-to-end checks

`integration/` is reserved for cross-module scenarios, and `e2e/` for the browser flow client → deal → invoice → paid → dashboard. These will be added after the respective modules; Days 1–2 do not include the full business flow.

Current backend tests live in `backend/tests/` (pytest, PostgreSQL). UI and typed fetch tests live in `frontend/tests/` (Vitest, Testing Library). See the root README for test commands.
