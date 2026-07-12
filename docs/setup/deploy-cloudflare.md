# Deploying RepoWrangler to Cloudflare

Target: one Worker serving the API and the React SPA, one D1 database, two
Cron triggers — all inside the free plan for a normal personal estate.

## Prerequisites

- Cloudflare account (free plan is fine)
- Node.js 20+ and pnpm
- `wrangler` authenticated: `pnpm exec wrangler login`

## Steps

### 1. Create the D1 database

```bash
pnpm exec wrangler d1 create repo-wrangler
```

Put the returned `database_id` in a **git-ignored** `wrangler.local.jsonc` (see
the repo-root README) — **not** the committed `wrangler.jsonc`, which ships
placeholders only:

```jsonc
// wrangler.local.jsonc — never committed
{ "d1_databases": [ { "binding": "DB", "database_name": "repo-wrangler",
  "database_id": "<your-d1-database-id>", "migrations_dir": "migrations" } ] }
```

Deploy with both configs layered: `wrangler deploy -c wrangler.jsonc -c wrangler.local.jsonc`.

### 2. Apply migrations

```bash
pnpm db:migrate:remote
```

### 3. Set secrets

```bash
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY   # paste full PEM
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET           # long random string
wrangler secret put ALLOWED_GITHUB_USERS     # comma-separated; first login is the owner
```

(Skip all of these to run a demo-mode deployment with synthetic data.)

Keep your allowlist a **secret**, not a committed `var` — that keeps your login
out of the public repo and survives Workers-Builds redeploys.

### 4. Configure vars

`DEMO_MODE` and `PUBLIC_BASE_URL` are the only vars you set per deployment (in
the dashboard, or in your git-ignored `wrangler.local.jsonc`): set
`DEMO_MODE` to `"false"` and `PUBLIC_BASE_URL` to your Worker URL. Do **not** add
`database_id` or `ALLOWED_GITHUB_USERS` to the committed `wrangler.jsonc` — the
first lives in `wrangler.local.jsonc` (step 1), the second is a secret (step 3).

The first login in `ALLOWED_GITHUB_USERS` gets the `owner` role; the rest get
`admin`.

### 5. Build and deploy

```bash
pnpm deploy        # = pnpm build && wrangler deploy
```

### 6. Continuous deployment (recommended)

Connect the repository to **Cloudflare Workers Builds** so pushes to `main`
build and deploy automatically, with preview builds for pull requests. Build
command: `pnpm install && pnpm build`; deploy command: `wrangler deploy`.

## Free-tier posture

- Static SPA assets are served without Worker invocations.
- Dashboard reads come from D1 snapshots — no provider fan-out per page view.
- The sync engine claims bounded batches (≤3 jobs, ~40 subrequests per cron
  tick) and checkpoints a cursor after every page, so a large estate simply
  takes more ticks instead of blowing the CPU/subrequest budget.
- Retention compaction runs daily (03:17 UTC by default).

If your estate outgrows the 10 ms CPU allowance, the first upgrade is the $5
Workers Paid plan — no architectural change (ADR-001).

## Operations

- **Liveness:** `GET /health/live` · **Readiness:** `GET /health/ready`
- **Platform Health** page: sync backlog, webhook failures, connection state,
  manual discovery trigger.
- **Backups:** `wrangler d1 export repo-wrangler` on your own schedule.
