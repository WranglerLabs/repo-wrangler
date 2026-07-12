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

Copy the returned `database_id` into `wrangler.jsonc`.

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
```

(Skip all of these to run a demo-mode deployment with synthetic data.)

### 4. Configure vars

In `wrangler.jsonc` (or the dashboard): set `DEMO_MODE` to `"false"`,
`PUBLIC_BASE_URL` to your Worker URL, and add:

```jsonc
"vars": {
  "AUTH_MODE": "github_app",
  "DEMO_MODE": "false",
  "PUBLIC_BASE_URL": "https://repo-wrangler.<account>.workers.dev",
  "ALLOWED_GITHUB_USERS": "your-github-login"
}
```

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
