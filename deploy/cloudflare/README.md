# Deploy — Cloudflare integrated Worker (Tier 0 · Integrated topology)

The default topology: one Worker serves the SPA static assets and the API + D1.
Zero cross-origin config, fits the Cloudflare free tier.

## Prerequisites

- A Cloudflare account and `wrangler` authenticated (`wrangler login`, or
  `CLOUDFLARE_API_TOKEN` in CI).
- Node 20+ and `pnpm`.

## Steps

1. **Create your D1 database** (one-time):

   ```bash
   wrangler d1 create repo-wrangler
   ```

   Put the returned id in a **git-ignored** `wrangler.local.jsonc` (see the repo
   root README) — never in the committed `wrangler.jsonc`.

2. **Apply migrations:**

   ```bash
   pnpm db:migrate:remote
   ```

3. **Set secrets** (never committed):

   ```bash
   wrangler secret put GITHUB_APP_ID
   wrangler secret put GITHUB_APP_PRIVATE_KEY
   wrangler secret put GITHUB_WEBHOOK_SECRET
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   wrangler secret put SESSION_SECRET
   wrangler secret put ALLOWED_GITHUB_USERS
   ```

4. **Build and deploy:**

   ```bash
   pnpm build
   wrangler deploy -c wrangler.jsonc -c wrangler.local.jsonc
   ```

5. Set `DEMO_MODE=false` and `PUBLIC_BASE_URL` on the deployment once your GitHub
   App is installed.

`VITE_API_BASE_URL` and `CORS_ALLOWED_ORIGINS` stay **empty** in this mode — the
SPA and API share an origin.

The [`ci.yml`](ci.yml) workflow builds and deploys on push to `main` when
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets are set.
