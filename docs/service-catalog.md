# Service catalog

The runtime components a RepoWrangler deployment is made of, what each does, and
its operational properties. Use it to reason about scaling, failure, and
monitoring. Which components exist depends on the target (see
[deployment.md](deployment.md)).

| Service | Package | Role | State | Scale | Health signal |
|---|---|---|---|---|---|
| **Web SPA** | `apps/web` | React UI served as static assets | none | CDN / any static host | HTTP 200 on `/` |
| **API** | `apps/worker` | Hono JSON API, auth, webhook receiver | none (uses the store) | horizontal on PostgreSQL; 1 replica on SQLite | `GET /health/live`, `/health/ready` |
| **Scheduler** | `apps/worker` (`runScheduled`) | Fires incremental (`*/15`) + daily (`17 3`) sync | in-flight guard only | exactly **one** replica | `platform-health` sync-job state |
| **Data store** | D1 / `persistence-sqlite` / `persistence-postgres` | Normalized estate snapshot | **stateful** — back this up | D1 edge-managed / SQLite single-node / PostgreSQL shared | `/health/ready` (503 if not migrated) |
| **Host shell** | Cloudflare Worker or `apps/server` | Runs the API + serves SPA + drives cron | none | per target | process up |
| **GitHub provider** | `provider-github` | Read-only GitHub ingestion | none | with the API | connection status |
| **GitLab provider** | `provider-gitlab` | Read-only GitLab ingestion (optional) | none | with the API | connection status |
| **Mock provider** | `provider-mock` | Demo-mode data | none | n/a | demo mode |

## Where each service runs per target

| Target | SPA | API + Scheduler | Store |
|---|---|---|---|
| Cloudflare Worker | Worker assets | Worker + wrangler cron | D1 |
| Docker / compose | served by `apps/server` | `apps/server` (in-process cron) | SQLite (volume) |
| Azure Container Apps | served by `apps/server` | `apps/server` | SQLite (Azure Files) or PostgreSQL |
| Kubernetes | served by `apps/server` | `apps/server` | SQLite (PVC) or PostgreSQL |
| Decoupled SPA | GitHub Pages / Azure SWA | Cloudflare Worker | D1 |

## Operational notes

- **The only stateful service is the data store** — everything else is derived and
  redeployable. Back up the store; see [operations.md](operations.md).
- **Scheduler singleton:** with more than one API replica (PostgreSQL), disable the
  in-process scheduler on all but one replica (`ENABLE_SCHEDULER=false`).
- **Idempotent sync + tombstone deletes** mean a rebuild-from-providers converges
  to correct state if the store is lost.
- **Monitoring:** poll `/health/live` for liveness, `/health/ready` for readiness,
  and `/api/v1/platform-health` for sync/webhook/provider health.
