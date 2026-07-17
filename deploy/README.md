# Deployment recipes

These are the source-controlled **manual deployment** recipes. Clone or fork
RepoWrangler and run them directly, or adapt them to your own CI/CD system.

Windows operators who do not want a source checkout may instead evaluate the
separate [Ranch Hand deployment manager](https://github.com/WranglerLabs/ranch-hand).
Ranch Hand consumes the immutable bundles published with RepoWrangler v1.0.10;
its current Windows build is an unsigned evaluation candidate, not a signed
public installer. The
[operator guide](https://github.com/WranglerLabs/ranch-hand/blob/main/docs/operator-guide.md)
documents acquisition, verification, target prerequisites, and current limits.
Manual deployment remains supported whether or not Ranch Hand is used.

Every recipe is described two ways: by **tier** (cost/scale — how the docs picker
sorts them, see the [deployment guide](https://wranglerlabs.org/deployment)) and by **topology**
(how the pieces are wired, per [ADR-011](https://wranglerlabs.org/adr/ADR-011-host-agnostic-frontend)).
The two axes are independent.

## Topologies

Pick one topology; it's orthogonal to which tier you're on.

| Topology | What runs where | Cost | Use when |
|---|---|---|---|
| **Integrated** | One Cloudflare Worker serves the SPA **and** the API + D1 | Free tier | Default. Simplest, zero cross-origin config. |
| **Decoupled** | SPA on a static host (GitHub Pages / Azure SWA / Cloudflare Pages); API on a Worker | Free tier | You want the UI on a host you already use, or a custom domain served elsewhere. |
| **Self-hosted** | One Node container serves the SPA **and** the API over SQLite/Postgres — no Cloudflare | Free (your compute) and up | Home lab, a VM, another PaaS, or Kubernetes. See [`docker/`](docker/). |

> **Historical note:** these three were previously labeled **Mode A / B / C**.
> The letters were dropped in favor of the names so they don't collide with the
> cost **tiers** (Tier 0–3), which now own the numbers. ADR-011 records the
> original decision.

## The one rule that makes the Decoupled topology work

The SPA is a **pure static bundle**. Point it at your Worker API at **build time**:

```bash
VITE_API_BASE_URL=https://<your-worker-host> pnpm --filter @repo-wrangler/web build
```

…and allow that SPA origin on the Worker:

```bash
wrangler secret put CORS_ALLOWED_ORIGINS   # e.g. https://you.github.io
```

Empty `VITE_API_BASE_URL` + empty `CORS_ALLOWED_ORIGINS` = the Integrated
topology (same-origin).

## Recipes

| Recipe | Tier | Topology | Notes |
|---|---|---|---|
| [`cloudflare/`](cloudflare/) | 0 | Integrated | The integrated Worker — recommended first deploy. |
| [`docker/`](docker/) | 0 | Self-hosted | Node container on SQLite, zero Cloudflare. |
| [`github-pages/`](github-pages/) | 0 | Decoupled | SPA on GitHub Pages + Worker API. Free but two-piece. |
| [`azure-swa/`](azure-swa/) | 0 | Decoupled | SPA on Azure Static Web Apps + Worker API. Free but two-piece. |
| [`azure-container-apps/`](azure-container-apps/) | 1 (SQLite) · 2 (Postgres) | Self-hosted | ACA (bicep + `az acr build`), Azure Files volume or Key Vault-backed Postgres. |
| [`kubernetes/`](kubernetes/) | 2 | Self-hosted | Any cluster (raw manifests + a Helm chart), PVC SQLite or managed Postgres. |

All Self-hosted recipes deploy the **same** `apps/server` container — the verified
SQLite host. They differ only in the surrounding infrastructure (volume, secrets,
ingress). Pointing `DATABASE_URL` at a shared **PostgreSQL**
([ADR-015](https://wranglerlabs.org/adr/ADR-015-postgres-storage-adapter)) unlocks multi-replica
scale and moves a self-hosted recipe from Tier 1 to Tier 2 — same host, no recipe
change.

Each directory has a `README.md` recipe and a copy-ready CI workflow.
