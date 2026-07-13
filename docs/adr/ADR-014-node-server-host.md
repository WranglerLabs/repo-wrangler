# ADR-014: Node server host for zero-Cloudflare deployment

- **Status:** Accepted
- **Date:** 2026-07-12
- **Relates to:** [ADR-011 (host-agnostic frontend)](ADR-011-host-agnostic-frontend.md),
  [ADR-013 (platform-neutral architecture)](ADR-013-platform-neutral-architecture.md),
  [ADR-005 (D1 storage)](README.md)

## Context

ADR-013 commits RepoWrangler to platform neutrality: Cloudflare is the
*reference* implementation, not a requirement. ADR-011 already made the frontend
host-agnostic. But the **backend** still only ran as a Cloudflare Worker — the
API was reachable only through Workers, D1, and wrangler cron. A deployer without
a Cloudflare account (home lab, an on-prem VM, another PaaS, Kubernetes) had no
way to run the product.

Two seams were already in place to close this gap:

1. `@repo-wrangler/persistence-sqlite` — a D1-compatible adapter over Node 22's
   built-in `node:sqlite` (no native dependency). The persistence layer and the
   entire API run against it unchanged.
2. `apps/worker/src/index.ts` re-exports `{ app, runScheduled }` and the `Env`
   type, so the Hono app and scheduler can be driven by a non-Cloudflare host.

What was missing was the **host shell** that assembles those seams into a running
process.

## Decision

Add `apps/server` — a Node host that runs the exact same app on SQLite:

- **HTTP shell:** [`@hono/node-server`](https://github.com/honojs/node-server)
  serves `app.fetch(request, env, ctx)` with a host-constructed `Env`.
- **Storage:** `openSqliteD1()` opens a SQLite file and is cast to the D1 API;
  `applyMigrations()` runs the repo's `migrations/*.sql` at boot (parity with the
  Worker's auto-migrating deploy).
- **SPA:** the host serves `apps/web/dist` with SPA fallback, reproducing the
  Cloudflare assets runtime (`run_worker_first` → the same worker path prefixes).
- **Cron:** a minute-tick scheduler fires the *same two* cron expressions
  (`*/15 * * * *`, `17 3 * * *`) into `runScheduled`, with an in-flight guard and
  an `ENABLE_SCHEDULER` off-switch for multi-replica hosts.
- **Config/secrets:** every field of `Env` is read from `process.env` — identical
  in meaning to wrangler vars and `secret put`.
- **Packaging:** a `Dockerfile` (build SPA → run on Node 22) and a root
  `docker-compose.yml` that boots the whole product in demo mode with one command.

The app, providers, domain, contracts, and UI are **not modified**. Only a new
host package is added.

## Consequences

- **Positive:** RepoWrangler is deployable anywhere a container runs, at zero
  licensing cost, with no Cloudflare dependency. `docker compose up` is now the
  simplest possible "try it" path. The single-binary SQLite store needs no
  external database for small/solo deployments.
- **Node 22 pin:** `node:sqlite` is behind `--experimental-sqlite` on Node 22;
  the Dockerfile and `start` script pass it, and Node 22 is pinned so the flag is
  always correct. Newer Node lines stabilise the module.
- **SQLite scope:** SQLite fits a single-node deployment. Horizontal scale and
  larger estates want Postgres — that is the next storage adapter (roadmap PN-1),
  built behind the same `StoragePort` seam, not a rewrite of this host.
- **Scheduling is in-process** for now. A dedicated scheduler process / external
  tick (`IScheduler`, PN-3) is a later refinement; `ENABLE_SCHEDULER=false`
  already exposes the seam.
