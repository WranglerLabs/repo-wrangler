# Roadmap

> **North star — Platform neutrality (ADR-013).** No cloud, host, database, or
> deployment model is a hard requirement. Cloudflare is the **reference
> implementation, not the required one.** See
> [docs/design/platform-neutrality.md](docs/design/platform-neutrality.md).

## Platform neutrality (in progress)

Make every infrastructure concern an interface with swappable adapters so the
same app runs on Cloudflare, Azure, Docker/self-hosted, or a home lab unchanged.

- **PN-1 Storage (`IDataStore`):** `persistence-core` seam ✅ + D1-compatible
  **SQLite adapter** ✅ + D1-compatible **PostgreSQL adapter** ✅
  (`persistence-postgres`, selected by `DATABASE_URL`; shared migrations via
  compatibility `datetime()` functions + a unit-tested translator; runtime-verified
  against a real PostgreSQL engine — [ADR-015](docs/adr/ADR-015-postgres-storage-adapter.md)).
  This unlocks **multi-replica** self-hosted deployments.
- **PN-2 Host:** a Node/Hono server host (`apps/server`) so the backend runs
  with no Cloudflare ✅ — SQLite storage, auto-applied migrations, self-served
  SPA, in-process cron, and Docker/compose packaging (one-command demo). See
  [ADR-014](docs/adr/ADR-014-node-server-host.md). Postgres storage (PN-1) ✅ now
  supports multi-replica hosts; a dedicated scheduler process (PN-3) is a later
  refinement (`ENABLE_SCHEDULER=false` already runs one scheduler across replicas).
- **PN-3 Scheduling (`IScheduler`):** abstract Cron; add Linux-cron / external-tick
  drivers for non-Cloudflare hosts. *Not yet built.*
- **PN-4 Secrets (`ISecretProvider`):** abstract secret access; env-vars + Azure
  Key Vault + Docker/K8s implementations. *Not yet built.*
- **PN-5 Auth (`IAuthenticationProvider`):** GitHub OAuth ✅ + **Microsoft Entra
  ID (OIDC)** ✅ (`AUTH_MODE=entra`; same signed session cookie, `/auth/config`
  drives the SPA button — [ADR-016](docs/adr/ADR-016-entra-id-authentication.md)).
  Remaining: GitLab, Google, local-dev sign-in behind the same seam.
- **PN-6 Cache/Notify/Jobs (`ICacheProvider`/`INotificationProvider`/`IBackgroundJobProvider`):**
  formalize interfaces; Redis, Teams/Slack/Discord, queue/Hangfire adapters. *Roadmap.*
- **PN-7 Per-target deploy recipes + adapter-matrix CI.** Recipes ✅ for
  Cloudflare, GitHub Pages, Azure SWA, **Docker/compose, Azure Container Apps
  (bicep + `az acr build` + Azure Files + Key Vault), and Kubernetes (manifests +
  Helm chart)** — all Mode C targets deploy the verified `apps/server` SQLite
  container (or PostgreSQL via `DATABASE_URL`, PN-1 ✅). Remaining: an
  adapter-matrix CI job running the suite against SQLite and PostgreSQL.

## Documentation suite (core deliverables ✅)

Deliver RepoWrangler as a **fully documented open-source product** — see
[docs/design/documentation-plan.md](docs/design/documentation-plan.md) and the
[docs index](docs/README.md). Cloudflare is documented as the reference
implementation, not a requirement.

- **DOC-1 Structure & index** ✅: full `docs/` tree + [docs index](docs/README.md)
  linking getting-started, deployment, configuration, providers, architecture,
  reference, operations, security, developer, troubleshooting, and design.
- **DOC-2 Quick-starts** ✅: [getting-started.md](docs/getting-started.md)
  (Docker one-command + local dev) and per-target quick-starts in the
  [deployment guide](docs/deployment.md) and each [`deploy/*/README.md`](deploy/).
- **DOC-3 Deployment guides** ✅: [deployment.md](docs/deployment.md) with the
  capability matrix + decision flowchart; one recipe per target under `deploy/`.
- **DOC-4 Architecture set** ✅: [architecture.md](docs/architecture.md) — C4
  context/container/component views + Mermaid diagrams + the three portability seams.
- **DOC-5 Reference** ✅: [API reference](docs/api.md),
  [configuration reference](docs/configuration.md),
  [service catalog](docs/service-catalog.md),
  [provider capability matrix](docs/provider-capability-matrix.md), and the
  database schema ([`migrations/`](migrations/)).
- **DOC-6 Operations & security** ✅: [operations.md](docs/operations.md)
  (sync/backup/restore/DR/upgrade/migrations + runbooks) and
  [security.md](docs/security.md) (trust boundaries, secret storage, hardening,
  disclosure).
- **DOC-7 Developer/contributor** ✅: [developer.md](docs/developer.md) — layout,
  adding a provider/storage/auth adapter, migrations, releases, ADR authoring.
- **DOC-8 Docs website:** the `docs/` tree is portable Markdown ready for a static
  site; publishing via GitHub Actions (Starlight/VitePress/MkDocs) remains an
  optional follow-up, decoupled from the app host.
- **DOC-quality-gate:** a feature is not complete until its user/admin/config/security/
  deployment docs, validation steps, troubleshooting, diagrams, API docs, and credits are
  updated. PRs require doc changes when code affects behavior/deploy/config/security/arch.

Each documentation deliverable tracks its matching Platform-neutrality (PN-*) and product
phase, so docs land with the capability they describe — never after.

---

The original phased product roadmap lives in the
[solution design pack](docs/design/RepoWrangler-Solution-Design.md). Summary:

- **Phase 0 — Foundation and governance** ✅ done: public repo, license and
  credits machinery, CI + CodeQL, issue/PR templates, runbooks, demo mode
  without secrets. **Host-agnostic frontend** (ADR-011): the SPA deploys to
  Cloudflare (integrated, default), GitHub Pages, or Azure Static Web Apps via
  `VITE_API_BASE_URL` + a Worker CORS allowlist, with per-host recipes under
  `deploy/`. Package seams for backend portability in place
  (`persistence-core`), plus shared `ui` tokens and `test-support` fixtures.
- **Phase 1 — GitHub estate MVP** ✅ done: GitHub App connection, automatic
  discovery, D1 inventory, Command Center, workflow/PR state, connection
  health. Spike outcomes recorded in `docs/research/`.
- **Phase 2 — Branch and change intelligence** ✅ done: estate Branches and
  Change Requests pages, FR-005 comparison semantics, exclusion patterns.
- **Phase 3 — Governance, security, budgets, usage** ✅ done: protection and
  hygiene checks, security alert reconciliation, budget sync, estate Security
  and Budgets & Usage pages, capability-state UX, JSON export. Enhanced
  billing usage ingestion still needs validation against an enhanced-billing
  organization.
- **Phase 4 — GitLab provider** ✅ done: groups/subgroups discovery,
  pipelines, MRs, branch comparison, optional webhooks, unified estate views.
- **Phase 5 — Notifications and controlled operations** 🚧 partial: outbound
  escalation webhook shipped. Remaining: Teams/Slack/Discord connectors,
  acknowledgements/quiet hours, optional rerun action via a separate write
  path, PWA shell.
- **Phase 6 — Ecosystem:** Azure DevOps/Bitbucket, MCP server, self-hosted
  Node/PostgreSQL target, multi-user views.
