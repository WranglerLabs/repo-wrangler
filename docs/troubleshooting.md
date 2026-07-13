# Troubleshooting

Symptoms and fixes for the common cases. Start with `GET /health/ready` and
`GET /api/v1/platform-health` — they report readiness, sync-job state, webhook
counts, and provider connection health.

## Startup & health

**`/health/ready` returns 503 "Database not ready".**
Migrations haven't applied. On the Node host, check boot logs for
`applied N migration(s)`; ensure `MIGRATIONS_DIR` points at `migrations/` and the
DB path/URL is writable/reachable. On Cloudflare, ensure the deploy pipeline ran
`d1 migrations apply`.

**Node host won't start: `ERR_MODULE_NOT_FOUND 'tsx'` or `node:sqlite` error.**
Use Node 22 and the provided scripts (`pnpm start:server`) — the SQLite path needs
`--experimental-sqlite`, which the script passes. In Docker, use the shipped image
(the flag is baked in).

**Blank page / SPA not served (Node host).**
Build the SPA first: `pnpm --filter @repo-wrangler/web build` (or use the Docker
image, which builds it). Check `WEB_DIST` resolves to `apps/web/dist`.

## Sign-in

**Stuck in demo / no sign-in button gate.**
`DEMO_MODE=true` (or no GitHub App configured) bypasses auth by design. Set
`DEMO_MODE=false` and configure a data provider to enable real sign-in.

**"This account is not authorized for this instance." (403)**
The signed-in identity isn't on the allowlist — add it to `ALLOWED_GITHUB_USERS`
or `ENTRA_ALLOWED_USERS`. The first allowlisted user to sign in becomes the owner.

**GitHub OAuth: "Invalid OAuth state." (400)**
Cookies blocked or `PUBLIC_BASE_URL` mismatched. Ensure HTTPS, that
`PUBLIC_BASE_URL` matches the callback host, and that the OAuth callback is
`{PUBLIC_BASE_URL}/auth/github/callback`.

**Entra: `AADSTS50011` redirect mismatch.**
The Entra app's redirect URI must exactly equal
`{PUBLIC_BASE_URL}/auth/entra/callback` (scheme + host + path).

**Entra: button still says "Sign in with GitHub".**
`AUTH_MODE` isn't `entra`, or the SPA cached `/auth/config` — hard-refresh. Verify
`GET /auth/config` returns `{ "mode": "entra" }`.

**Entra: "Nonce mismatch" / "Untrusted token issuer".**
Third-party cookies blocked (nonce cookie lost), or `ENTRA_TENANT_ID` doesn't
match the signing tenant. Use the specific tenant GUID for a single-tenant app.

## Providers & sync

**No repositories appear.**
Confirm the GitHub App is **installed** on the target accounts/orgs, `DEMO_MODE`
is `false`, and provider secrets are set. Trigger `POST /api/v1/admin/sync` and
watch `platform-health`.

**GitHub org App URL 404s when creating the App.**
You're not an owner of that org — use the personal-account App path
(`https://github.com/settings/apps/new`). See
[setup/github-app.md](setup/github-app.md).

**Webhooks not arriving.**
Check the webhook secret matches (`GITHUB_WEBHOOK_SECRET`/`GITLAB_WEBHOOK_SECRET`),
the URL is publicly reachable (`/webhooks/github` or `/webhooks/gitlab`), and TLS
is valid. `platform-health` shows 24h delivery counts. Sync still runs on the
schedule without webhooks.

**GitLab estate empty.**
GitLab needs **both** `GITLAB_TOKEN` and `GITLAB_GROUPS`. For self-managed GitLab,
set `GITLAB_BASE_URL`. The token needs read scopes and must not be expired.

## Database

**PostgreSQL: connection/SSL errors.**
Verify `DATABASE_URL` host/credentials and add `?sslmode=require` for managed
providers (Azure Database for PostgreSQL requires TLS).

**Multiple replicas double-syncing.**
Run the scheduler on exactly one replica — set `ENABLE_SCHEDULER=false` on the
others.

**SQLite "database is locked" under load.**
SQLite is single-writer; for concurrency/multiple replicas switch to PostgreSQL
(`DATABASE_URL`). See [ADR-015](adr/ADR-015-postgres-storage-adapter.md).

## Decoupled SPA (Mode B)

**API calls fail with CORS errors.**
Add the exact SPA origin to `CORS_ALLOWED_ORIGINS` on the API, and build the SPA
with `VITE_API_BASE_URL` pointing at the API origin. Requests must send
credentials.

## Still stuck?

Gather `/health/ready`, `/api/v1/platform-health`, and the relevant deploy logs,
then see [SUPPORT.md](../SUPPORT.md).
