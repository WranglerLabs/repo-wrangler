# Roadmap

> **North star — Platform neutrality (ADR-013).** No cloud, host, database, or
> deployment model is a hard requirement. Cloudflare is the **reference
> implementation, not the required one.** See
> [docs/design/platform-neutrality.md](docs/design/platform-neutrality.md).

## Platform neutrality (in progress)

Make every infrastructure concern an interface with swappable adapters so the
same app runs on Cloudflare, Azure, Docker/self-hosted, or a home lab unchanged.

- **PN-1 Storage (`IDataStore`):** `persistence-core` seam ✅ + D1-compatible
  **SQLite adapter** ✅. Remaining: wire the API through the seam (not raw D1),
  add a PostgreSQL adapter.
- **PN-2 Host:** a Node/Hono server host (SQLite/Postgres) so the backend runs
  with no Cloudflare — deployable to Docker, Azure Container Apps/App Service,
  Kubernetes. *Not yet built.*
- **PN-3 Scheduling (`IScheduler`):** abstract Cron; add Linux-cron / external-tick
  drivers for non-Cloudflare hosts. *Not yet built.*
- **PN-4 Secrets (`ISecretProvider`):** abstract secret access; env-vars + Azure
  Key Vault + Docker/K8s implementations. *Not yet built.*
- **PN-5 Auth (`IAuthenticationProvider`):** GitHub OAuth today; add Entra ID,
  GitLab, Google, local-dev. *Not yet built.*
- **PN-6 Cache/Notify/Jobs (`ICacheProvider`/`INotificationProvider`/`IBackgroundJobProvider`):**
  formalize interfaces; Redis, Teams/Slack/Discord, queue/Hangfire adapters. *Roadmap.*
- **PN-7 Per-target deploy recipes + adapter-matrix CI.** *Roadmap.*

## Documentation suite (in progress, parallel workstream)

Deliver RepoWrangler as a **fully documented open-source product** — see
[docs/design/documentation-plan.md](docs/design/documentation-plan.md). Cloudflare is
documented as the reference implementation, not a requirement.

- **DOC-1 Structure & index:** stand up the full `docs/` tree (getting-started,
  architecture, deployment, configuration, providers, operations, security,
  development, reference, design, open-source, troubleshooting) + a docs index.
- **DOC-2 Quick-starts:** Local Docker, Cloudflare free tier, Azure (SWA + Container
  Apps), Kubernetes — each with prerequisites, cost, validation, cleanup.
- **DOC-3 Deployment guides:** one per target profile, using the standard section set.
- **DOC-4 Architecture set:** C4-style context/logical/component/data/deployment/
  security/synchronization docs + the Mermaid diagram library (Lucid plan on top).
- **DOC-5 Reference:** OpenAPI/API reference, configuration reference, service catalog,
  provider capability matrix, database schema, health rules, glossary.
- **DOC-6 Operations & security:** runbooks, backup/restore/DR, threat model, secure
  deployment, vulnerability reporting.
- **DOC-7 Developer/contributor:** dev setup, adding provider/storage/auth/scheduler/
  notification adapters, migrations, releases, ADR authoring.
- **DOC-8 Docs website:** evaluate Docusaurus/VitePress/MkDocs Material/Astro Starlight;
  publish free via GitHub Actions, decoupled from the app host.
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
