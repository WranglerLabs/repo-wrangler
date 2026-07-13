# Deployment recipes

RepoWrangler supports two topologies (see
[ADR-011](../docs/adr/ADR-011-host-agnostic-frontend.md)). Pick one:

| Mode | What runs where | Cost | Use when |
|---|---|---|---|
| **A — Integrated** | One Cloudflare Worker serves the SPA **and** the API + D1 | Free tier | Default. Simplest, zero cross-origin config. |
| **B — Decoupled** | SPA on a static host (GitHub Pages / Azure SWA / Cloudflare Pages); API on a Worker | Free tier | You want the UI on a host you already use, or a custom domain served elsewhere. |
| **C — Self-hosted** | One Node container serves the SPA **and** the API over SQLite — no Cloudflare | Free (your compute) | Home lab, a VM, another PaaS, or Kubernetes. See [`docker/`](docker/). |

## The one rule that makes Mode B work

The SPA is a **pure static bundle**. Point it at your Worker API at **build time**:

```bash
VITE_API_BASE_URL=https://<your-worker-host> pnpm --filter @repo-wrangler/web build
```

…and allow that SPA origin on the Worker:

```bash
wrangler secret put CORS_ALLOWED_ORIGINS   # e.g. https://you.github.io
```

Empty `VITE_API_BASE_URL` + empty `CORS_ALLOWED_ORIGINS` = Mode A (same-origin).

## Recipes

- [`cloudflare/`](cloudflare/) — Mode A, the integrated Worker (recommended first deploy).
- [`github-pages/`](github-pages/) — Mode B, SPA on GitHub Pages + Worker API.
- [`azure-swa/`](azure-swa/) — Mode B, SPA on Azure Static Web Apps + Worker API.
- [`docker/`](docker/) — Mode C, the self-hosted Node container (SQLite, zero Cloudflare).
- [`azure-container-apps/`](azure-container-apps/) — Mode C on Azure Container Apps (bicep + `az acr build`, Azure Files volume, Key Vault secrets).
- [`kubernetes/`](kubernetes/) — Mode C on any Kubernetes cluster (raw manifests + a Helm chart, PVC-backed SQLite).

All Mode C recipes deploy the **same** `apps/server` container — the verified
SQLite host. They differ only in the surrounding infrastructure (volume, secrets,
ingress). A shared-database backend for multi-replica scale (Postgres) is the
next platform-neutrality milestone (roadmap PN-1) and slots in behind the same
host without changing these recipes.

Each directory has a `README.md` recipe and a copy-ready CI workflow.
