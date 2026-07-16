# `@repo-wrangler/server` — Node server host (zero Cloudflare)

Runs RepoWrangler's **API, webhooks, auth, and scheduler on a plain Node
process backed by SQLite** — no Cloudflare account, no Workers, no D1. It serves
the built SPA and the API on a single port, so a fresh `docker compose up` gives
you the whole product on `http://localhost:8080`.

This is the reference realisation of the design's **Portability** section
([ADR-011](https://wranglerlabs.org/adr/ADR-011-host-agnostic-frontend),
[ADR-013](https://wranglerlabs.org/adr/ADR-013-platform-neutral-architecture)): the same
Hono app, providers, domain, and API that the Cloudflare Worker runs, hosted on
a different shell over a different storage adapter. Cloudflare stays the
*reference* implementation, not a requirement.

## How it works

| Concern | Cloudflare Worker | This host |
|---|---|---|
| HTTP shell | `ExportedHandler.fetch` | [`@hono/node-server`](https://github.com/honojs/node-server) |
| App | `@repo-wrangler/worker` `app` | the **same** `app`, imported |
| Storage | D1 binding | `@repo-wrangler/persistence-sqlite` (`node:sqlite`), cast to the D1 API |
| SPA assets | CF assets runtime | `src/static.ts` serves `apps/web/dist` + SPA fallback |
| Cron | wrangler `triggers.crons` | `src/scheduler.ts` — the same two cron expressions |
| Config/secrets | wrangler vars + `secret put` | `process.env` (`.env` / compose / K8s secrets) |

The Worker's `apps/worker/src/index.ts` re-exports `{ app, runScheduled }` and
`Env` for exactly this purpose — the portability seam.

## Run it — Docker (recommended)

From the **repository root**:

```bash
docker compose up --build        # → http://localhost:8080  (demo mode, mock data)
```

For a real instance, copy the example env, fill it in, and rebuild:

```bash
cp apps/server/.env.example .env     # edit: DEMO_MODE=false + GitHub App secrets
docker compose up -d --build
```

The SQLite database persists in the `rw-data` volume; migrations apply
automatically at boot.

## Run it — local Node

Requires **Node 22** (for the built-in `node:sqlite` module).

```bash
pnpm install
pnpm --filter @repo-wrangler/web build     # build the SPA once
pnpm --filter @repo-wrangler/server start   # → http://localhost:8080
```

`pnpm --filter @repo-wrangler/server dev` runs the same with `--watch`.

## Configuration

Everything is environment variables — see
[`.env.example`](.env.example) for the full list. Host-specific knobs:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `SQLITE_PATH` | `./data/repo-wrangler.db` (`/app/data/...` in Docker) | Database file |
| `MIGRATIONS_DIR` | `<repo>/migrations` | Ordered `*.sql` migrations |
| `WEB_DIST` | `<repo>/apps/web/dist` | Built SPA to serve |
| `ENABLE_SCHEDULER` | `true` | Run the in-process cron in this replica |

All the app-level config and secrets (`DEMO_MODE`, `ALLOWED_GITHUB_USERS`,
`GITHUB_APP_*`, `SESSION_SECRET`, GitLab, CORS…) are identical to the Worker
deployment.

## Why Node 22

`node:sqlite` is the standard-library SQLite binding — **no native dependency to
compile**. On Node 22 it lives behind `--experimental-sqlite` (the Dockerfile and
`start` script pass it). Newer Node lines stabilise it; Node 22 is pinned here so
the flag is always correct.

## Health

- `GET /health/live` → `{ ok, version }` (no DB call) — container healthcheck.
- `GET /health/ready` → `{ ok, demoMode }` or `503` until migrations have run.
