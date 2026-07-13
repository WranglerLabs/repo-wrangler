# Roadmap

> **North star — Platform neutrality (ADR-013).** No cloud, host, database, or
> deployment model is a hard requirement. Cloudflare is the **reference
> implementation, not the required one.** See
> [docs/design/platform-neutrality.md](docs/design/platform-neutrality.md).

## Platform neutrality — core seams ✅

Every infrastructure concern is an interface with swappable adapters, so the same
app runs on Cloudflare, Azure, Docker/self-hosted, or a home lab unchanged. The
core seams are complete:

- **PN-1 Storage (`IDataStore`):** `persistence-core` seam ✅ + D1-compatible
  **SQLite** ✅ and **PostgreSQL** ✅ adapters (`DATABASE_URL`-selected; shared
  migrations via a unit-tested translator; runtime-verified against real
  PostgreSQL — [ADR-015](docs/adr/ADR-015-postgres-storage-adapter.md)). Unlocks
  **multi-replica** self-hosted deployments.
- **PN-2 Host:** Node/Hono server host (`apps/server`) so the backend runs with no
  Cloudflare ✅ — auto-applied migrations, self-served SPA, Docker/compose
  packaging ([ADR-014](docs/adr/ADR-014-node-server-host.md)).
- **PN-3 Scheduling (`IScheduler`):** ✅ Cloudflare Cron + Node in-process timer +
  an **external-tick** driver — a token-guarded `POST /internal/cron/run` that lets
  Linux cron, a Kubernetes `CronJob`, GitHub Actions, or an Azure Functions timer
  drive sync (`SCHEDULER_MODE` — [ADR-018](docs/adr/ADR-018-scheduler-drivers.md)).
- **PN-4 Secrets (`ISecretProvider`):** ✅ environment variables, **Docker/Kubernetes
  mounted files**, and **Azure Key Vault** (managed identity, SDK-free), with a
  composite that layers them (`SECRET_SOURCE` —
  [ADR-017](docs/adr/ADR-017-secret-provider-seam.md)).
- **PN-5 Auth (`IAuthenticationProvider`):** ✅ a provider **registry** — GitHub
  OAuth, GitLab OAuth, Microsoft Entra ID, Google, and local-dev are peer adapters
  behind one signed session cookie; enable any combination with `AUTH_PROVIDERS`
  ([ADR-019](docs/adr/ADR-019-authentication-provider-registry.md)). No single
  provider is privileged — Entra is one row in the matrix, not "the" login.
- **PN-7 Per-target deploy recipes + adapter-matrix CI:** ✅ recipes for Cloudflare,
  GitHub Pages, Azure SWA, Docker/compose, Azure Container Apps (bicep + `az acr
  build` + Azure Files + Key Vault), and Kubernetes (manifests + Helm), **plus a CI
  adapter-matrix job** that boots the real server on SQLite and PostgreSQL and
  verifies migrations + a live query through the storage seam.

### Roadmap — remaining neutrality work

- **PN-6 Cache/Notify/Jobs (`ICacheProvider`/`INotificationProvider`/`IBackgroundJobProvider`):**
  formalize interfaces; Redis, Teams/Slack/Discord, queue/Hangfire adapters.

## Documentation suite ✅

RepoWrangler ships as a **fully documented open-source product** — see
[docs/design/documentation-plan.md](docs/design/documentation-plan.md) and the
[docs index](docs/README.md). Cloudflare is documented as the reference
implementation, not a requirement.

- **DOC-1 … DOC-7** ✅: structure/index, quick-starts, deployment guides (capability
  matrix + decision flowchart), C4 architecture set, reference (API, configuration,
  service catalog, provider matrix, schema), operations & security, and the
  developer/contributor guide.
- **DOC-8 Docs website** ✅: VitePress site published to GitHub Pages via
  `.github/workflows/docs.yml`, decoupled from the app host.
- **DOC-quality-gate:** a feature is not complete until its user/admin/config/
  security/deployment docs, validation steps, troubleshooting, diagrams, API docs,
  and credits are updated.

---

## Product phases

The original phased product roadmap lives in the
[solution design pack](docs/design/RepoWrangler-Solution-Design.md). Summary:

- **Phase 0 — Foundation & governance** ✅ — public repo, license/credits, CI +
  CodeQL, templates, runbooks, demo mode without secrets, host-agnostic frontend
  (ADR-011).
- **Phase 1 — GitHub estate MVP** ✅ — App connection, discovery, inventory,
  Command Center, workflow/PR state, connection health.
- **Phase 2 — Branch & change intelligence** ✅ — estate Branches and Change
  Requests, comparison semantics, exclusion patterns.
- **Phase 3 — Governance, security, budgets, usage** ✅ — protection/hygiene checks,
  security alert reconciliation, budget sync, estate Security and Budgets & Usage
  pages, JSON export.
- **Phase 4 — GitLab provider** ✅ — groups/subgroups discovery, pipelines, MRs,
  branch comparison, optional webhooks, unified estate views.

### Roadmap — future phases

*(Roadmap = designed but not part of the current "deploy-ready 100%".)*

- **Phase 5 — Notifications & controlled operations** 🚧 partial: outbound
  escalation webhook shipped. Remaining: Teams/Slack/Discord connectors,
  acknowledgements/quiet hours, optional rerun action via a separate write path,
  PWA shell.
- **Phase 6 — Ecosystem** — in priority order:
  1. **Azure DevOps repository provider** (top of the list — Repos, Pipelines, PRs).
  2. Bitbucket / Gitea / Forgejo providers.
  3. Multi-user views (multiple signed-in people with scoped, role-based views).
  4. MCP server exposing estate data to AI clients.

### Roadmap — Multi-cloud cost & quota observability

A cross-cutting dashboard that pulls **cost, billing, and usage-against-free-tier**
from every platform an estate touches, so you see *before* "free" tips into paid —
the way GitHub Actions minutes or Cloudflare Workers requests silently approach a
cap. Extends the Phase-3 budget sync from GitHub-only to a provider matrix:

- **Providers:** Cloudflare (Workers/D1/Pages usage vs free limits), Azure (Cost
  Management), AWS (Cost Explorer / Budgets), GCP (Billing), plus CI minutes
  (GitHub Actions, GitLab) and any provider already connected for repo data.
- **Surface:** a unified "Cost & Quota" estate page — spend to date, projected
  month-end, and **percent-of-free-tier consumed** with threshold alerts, reusing
  the existing capability-state UX (available / not-configured / unsupported).
- **Neutral by construction:** each billing source is an `ICostProvider` adapter
  behind the same seam pattern as storage/auth — no provider is required, each is
  optional and independently configured.
