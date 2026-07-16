# Deploy — SPA on GitHub Pages + Worker API (Tier 0 · Decoupled topology)

The UI is hosted free on GitHub Pages; the API runs on a Cloudflare Worker. See
[ADR-011](https://wranglerlabs.org/adr/ADR-011-host-agnostic-frontend).

## 1. Deploy the API Worker

Follow [`../cloudflare/README.md`](../cloudflare/README.md) steps 1–4 to stand up
the Worker + D1 + secrets. Note its URL, e.g.
`https://repo-wrangler.<subdomain>.workers.dev`.

Then allow your Pages origin on the Worker:

```bash
wrangler secret put CORS_ALLOWED_ORIGINS
# value: https://<user-or-org>.github.io   (no trailing slash, no path)
```

## 2. Build the SPA pointed at the Worker

GitHub Pages **project** sites serve from `/<repo>/`, so set the base path too:

```bash
VITE_API_BASE_URL=https://repo-wrangler.<subdomain>.workers.dev \
VITE_BASE_PATH=/repo-wrangler/ \
pnpm --filter @repo-wrangler/web build
```

For a **user/org** site (`<user>.github.io`) omit `VITE_BASE_PATH` (defaults to `/`).

## 3. Publish

Push `apps/web/dist` to GitHub Pages. The copy-ready workflow
[`ci.yml`](ci.yml) does this on every push to `main`; set the repo variables
`API_BASE_URL` and (for project sites) `BASE_PATH`, and enable Pages
(Settings → Pages → Source: GitHub Actions).

## Gotchas

- `VITE_API_BASE_URL` is baked at build time — changing the API host needs a rebuild.
- The origin in `CORS_ALLOWED_ORIGINS` must match the browser origin **exactly**
  (scheme + host, no path, no trailing slash).
- Auth cookies are cross-site in this mode; the Worker sends `credentials: true`
  and the SPA sends `credentials: 'include'` — keep both origins on HTTPS.
