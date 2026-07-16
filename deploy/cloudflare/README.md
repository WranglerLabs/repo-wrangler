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

3. **Set first-boot infrastructure secrets** (never committed):

   ```bash
   wrangler secret put SESSION_SECRET
   wrangler secret put SECRET_ENCRYPTION_KEY
   # Recommended when the initial deployment is reachable from the internet:
   wrangler secret put SETUP_TOKEN
   ```

4. **Build and deploy:**

   ```bash
   pnpm build
   wrangler deploy -c wrangler.jsonc -c wrangler.local.jsonc
   ```

5. Set `DEMO_MODE=false` and `PUBLIC_BASE_URL`, then open the deployment. The
   first-run wizard creates or connects the GitHub App and stores its provider
   credentials. If you prefer GitOps/pre-seeded credentials, set the five
   `GITHUB_*` secrets and `ALLOWED_GITHUB_USERS` before switching modes instead.

`VITE_API_BASE_URL` and `CORS_ALLOWED_ORIGINS` stay **empty** in this mode — the
SPA and API share an origin.

The [`ci.yml`](ci.yml) workflow builds and deploys on push to `main` when
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets are set.
