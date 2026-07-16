# Docker / self-hosted — zero Cloudflare

Run the **whole product** (SPA + API + scheduler) on your own machine or server,
backed by SQLite. No Cloudflare account, no D1, no Workers. This is the
**Self-hosted** topology on top of the two Cloudflare topologies in
[`../README.md`](../README.md). Cost tier: **Tier 0** (your own compute).

| Topology | What runs where | Cost | Use when |
|---|---|---|---|
| **Self-hosted** | One Node container serves the SPA **and** the API over SQLite | Tier 0 — free (your compute) | Home lab, a VM, Railway/Fly, Azure Container Apps, Kubernetes — anywhere that runs a container. |

## Quick start

From the repository root:

```bash
docker compose up --build        # → http://localhost:8080  (demo mode, mock data)
```

That's the public demo, self-hosted: mock data, no secrets.

## Real instance

```bash
cp apps/server/.env.example .env     # set DEMO_MODE=false + your GitHub App secrets
docker compose up -d --build
```

- Migrations apply automatically at boot.
- The SQLite database persists in the `rw-data` volume (`/app/data`).
- Point your GitHub App's webhook and OAuth callback at this instance's
  `PUBLIC_BASE_URL`.

## What powers it

The container runs [`@repo-wrangler/server`](../../apps/server/README.md), which
hosts the same Hono app as the Cloudflare Worker on `@hono/node-server` over the
`node:sqlite`-backed D1 adapter. See
[ADR-014](https://wranglerlabs.org/adr/ADR-014-node-server-host).

## Beyond a single container

`ENABLE_SCHEDULER=false` runs a stateless API replica with cron handled
elsewhere — the seam for Kubernetes/Container Apps with a separate scheduler
(roadmap PN-3). Postgres, Key Vault secrets, and Entra auth are the next
platform-neutrality milestones (PN-1/PN-4/PN-5).
