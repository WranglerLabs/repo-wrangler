# Deploy — SPA on Azure Static Web Apps + Worker API (Mode B)

The UI is hosted on Azure Static Web Apps (free tier); the API runs on a
Cloudflare Worker. See [ADR-011](../../docs/adr/ADR-011-host-agnostic-frontend.md).

## 1. Deploy the API Worker

Follow [`../cloudflare/README.md`](../cloudflare/README.md) to stand up the Worker
+ D1 + secrets, then allow your SWA origin:

```bash
wrangler secret put CORS_ALLOWED_ORIGINS
# value: https://<your-swa-name>.azurestaticapps.net  (or your custom domain)
```

## 2. Create the Static Web App

```bash
az staticwebapp create \
  --name repo-wrangler-ui \
  --resource-group <rg> \
  --sku Free \
  --location <region>
```

Copy the deployment token (`az staticwebapp secrets list …`) into the repo
secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.

## 3. Build + publish

The SWA serves from the domain root, so no `VITE_BASE_PATH` is needed:

```bash
VITE_API_BASE_URL=https://repo-wrangler.<subdomain>.workers.dev \
pnpm --filter @repo-wrangler/web build
```

The copy-ready workflow [`ci.yml`](ci.yml) builds and uploads `apps/web/dist` on
push to `main`. `staticwebapp.config.json` in this directory provides SPA
fallback routing (all paths → `index.html`) — copy it next to the built app.

## Gotchas

- Azure SWA's own managed API is unused here — the API is the Cloudflare Worker.
  `skip_app_build: true` and an empty `api_location` keep SWA from trying to build one.
- Same exact-origin CORS rule as GitHub Pages applies.
