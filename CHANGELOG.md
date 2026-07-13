# Changelog

All notable changes to RepoWrangler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project follows
semantic versioning.

## [Unreleased]

## [0.5.0] - 2026-07-13

### Added

- **More secret providers (PN-4):** **Cloudflare KV** (`cloudflare-kv`, REST — with a
  note that Cloudflare Secrets/Secrets Store is preferred for sensitive values) and
  **CyberArk** (`cyberark`, Central Credential Provider / AIM). `SECRET_SOURCE` now
  spans env/file/Azure/Vault/AWS/GCP/Cloudflare-KV/CyberArk/composite — no lock-in.
- **App version in the UI:** shown under the sidebar title (every page) and on the
  About & Credits page, served from `/auth/config`.
- **Docs:** sign-in provider setup guide (GitLab/Google/local), an "Updating your
  instance" guide, and a pre-1.0 maturity note on the auth + secret sections.
- **Release CD:** a tag-triggered `deploy-demo` workflow so the live demo follows
  the latest release (requires `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/
  `CF_D1_DATABASE_ID` repo secrets).

### Changed

- Credits page clarified: no upstream code copied — references/inspiration only.
- Workspaces subtitle no longer says "GitLab groups later" (GitLab is supported).

## [0.4.0] - 2026-07-13

### Added

- **Secret provider seam (`secrets-core`, PN-4, ADR-017):** secrets are read
  through an `ISecretProvider` selected by `SECRET_SOURCE` — environment variables,
  Docker/Kubernetes mounted files, Azure Key Vault, **HashiCorp Vault**, **AWS
  Secrets Manager**, and **GCP Secret Manager** (all SDK-free), plus a composite
  that layers them. No cloud is required.
- **Scheduler drivers (PN-3, ADR-018):** `SCHEDULER_MODE=in-process|external|off`
  plus a token-guarded `POST /internal/cron/run`, so Linux cron, a Kubernetes
  `CronJob`, GitHub Actions, or an Azure Functions timer can drive sync over HTTP.
- **Authentication provider registry (PN-5, ADR-019):** GitHub, GitLab, Entra,
  Google, and local-dev are peer sign-in providers behind one signed session
  cookie, enabled in any combination via `AUTH_PROVIDERS`; `/auth/config` lists
  each so the SPA renders a button per provider.
- **Deploy recipes** now wire the new knobs (K8s `CronJob` + `SECRET_SOURCE` /
  `AUTH_PROVIDERS`; Azure Container Apps `AUTH_PROVIDERS`; compose Docker-secrets).
- **Fun demo estate:** synthetic data themed after *Back to the Future* (GitHub)
  and *Pinky and the Brain* (GitLab), with the domain health engine unchanged.

### Changed

- CI runs checks only (typecheck + unit tests) — no build/bundle/boot steps.
- Credits page states plainly that no upstream code was copied (references only).

## [0.3.0-post] - PostgreSQL adapter, Entra ID, and the documentation suite

### Added

- **PostgreSQL storage adapter (`persistence-postgres`, ADR-015):** a
  D1-compatible adapter over PostgreSQL, selected on the Node host by setting
  `DATABASE_URL`. It runs the *same* persistence SQL and the *same* `migrations/`
  as SQLite/D1 via compatibility `datetime()` functions plus a small, unit-tested
  SQL translator (`?N`→`$N`, `INSERT OR IGNORE`→`ON CONFLICT DO NOTHING`,
  case-preserving aliases). This unlocks **multi-replica** self-hosted deployments
  (Azure Container Apps, Kubernetes) behind one shared database — run the scheduler
  on one replica with `ENABLE_SCHEDULER=false` on the rest. Runtime-verified
  against a real PostgreSQL engine. Closes roadmap **PN-1**.
- **Microsoft Entra ID sign-in (ADR-016):** an OpenID Connect
  authorization-code sign-in provider selected by `AUTH_MODE=entra`, alongside the
  default GitHub sign-in. It issues the same signed session cookie (roles,
  `/auth/me`, and the SPA unchanged), gates access by `ENTRA_ALLOWED_USERS`, and a
  new public `/auth/config` endpoint drives the SPA's sign-in button
  ("Sign in with Microsoft"). Web-Crypto-only, so it runs on both the Worker and
  the Node host. Closes roadmap **PN-5** (Entra).
- **Documentation suite (DOC-1…8):** a full `docs/` tree with an
  [index](docs/README.md) — getting-started, deployment (capability matrix +
  decision flowchart), configuration reference, provider guides (GitHub/GitLab/
  Entra), architecture (C4 + Mermaid), API reference, operations (backup/restore/
  DR/upgrade/migrations), security, developer guide, troubleshooting, service
  catalog, and provider capability matrix.
- **Node server host — zero Cloudflare (`apps/server`, ADR-014):** run the whole
  product (SPA + API + webhooks + auth + scheduler) on a plain Node 22 process
  backed by SQLite, with no Cloudflare account. It imports the *same* Hono app
  the Worker runs, over the `node:sqlite` D1 adapter; serves `apps/web/dist` with
  SPA fallback; applies migrations at boot; and fires the same two cron
  expressions in-process. Ships with a `Dockerfile` and a root
  `docker-compose.yml` — `docker compose up --build` boots the product in demo
  mode on `http://localhost:8080`. New deploy recipe `deploy/docker/` (topology
  **C — Self-hosted**). Closes roadmap **PN-2**.

- **Design-completeness pass** — closed the remaining functional-requirement gaps
  found in an audit against the solution design: **saved views** (FR-012, D1-backed,
  shareable within the instance), **CSV + Markdown report export** (FR-014, alongside
  JSON), the **Activity/sync-history** and **Provider-capabilities** repository-detail
  tabs (FR-013, now all 9 tabs), **row virtualization** for large inventory tables
  (NFR-002), and **PWA groundwork** — web manifest, service worker, and registration
  (goal 7 / FR-011).

- **Drop-in theming (ADR-012):** themes are self-contained CSS files under
  `apps/web/src/themes/` — dropping one in makes it appear in the sidebar theme
  switcher automatically (Hugo/Jekyll-style, via glob discovery), no code change.
  Ships with `light`, `dark`, `midnight`, `slate`, `sandstone`, `high-contrast`;
  deployers set the default with `VITE_DEFAULT_THEME`, users switch live (saved
  per browser). See `docs/guide/theming.md`.
- **Theme Studio (live color customization):** a `/theme` editor with color
  pickers for every token — apply your palette live as the **Custom** theme
  (saved per browser, no rebuild), seed from the current theme or reset, and
  **export** a committable `themes/<id>.css` to turn a personal palette into a
  permanent shared theme.
- **Host-agnostic frontend (ADR-011):** the SPA reads its API origin from
  `VITE_API_BASE_URL` (empty = integrated same-origin) and the Worker enforces a
  CORS allowlist via `CORS_ALLOWED_ORIGINS`. Two topologies — integrated
  Cloudflare Worker (default, zero-config) and decoupled SPA on any static host.
- **`deploy/` recipes + copy-ready CI** for Cloudflare (integrated), GitHub
  Pages, and Azure Static Web Apps.
- **New packages:** `persistence-core` (backend-neutral storage-port interfaces
  — the seam a future Node/Postgres backend fulfils), `ui` (framework-agnostic
  design tokens + capability presentation), `test-support` (deterministic domain
  fixtures).
- `VITE_BASE_PATH` support for GitHub Pages project sites.

### Changed

- **Public repo carries placeholders only:** `wrangler.jsonc` ships no real D1
  id or allowlist and defaults to demo mode. Deployers put their D1 id in a
  git-ignored `wrangler.local.jsonc` and set `ALLOWED_GITHUB_USERS` as a
  Cloudflare secret (README "Deploying your own instance" updated accordingly).
- Manifest setup form no longer prefills a specific organization login.

### Documentation

- The **personal-account GitHub App** path is documented as first-class,
  including the org-owner 404 and how to avoid it (`docs/setup/github-app.md`).

## [0.3.0] - 2026-07-12

### Added

- **Estate-wide navigation completed** (design IA items 5, 7, 8, 9, 10):
  - **Pipelines** page — latest workflow/pipeline state per repository,
    failures first, with duration and direct provider links.
  - **Security** page — open findings across the estate ordered by
    secret-scanning first, then severity; metadata only.
  - **Budgets & Usage** page — budgets per workspace with alert state and
    stop-at-limit flags; missing access rendered as a capability state.
  - **Activity** page — recent sync jobs, discoveries, and administrative
    audit events in one feed.
  - **Administration** page — session/role, connection setup guidance,
    manual discovery, and instance policy pointers.
- Supporting API endpoints: `GET /api/v1/pipelines`, `/security`, `/budgets`,
  `/activity`, with demo-mode fixtures.
- Open-source baseline: issue/PR templates, CodeQL analysis workflow,
  operations runbooks (key rotation, D1 backup/recovery, upgrade, provider
  reconnect), and research spike outcomes (`docs/research/`).
- Default owner allowlist configured via `ALLOWED_GITHUB_USERS`.

## [0.2.0] - 2026-07-12

### Added

- **Phase 2 — branch and change intelligence:** estate-wide Branches page
  (every branch ahead/diverged across all providers) and Change Requests page
  with blocked/stale/ready/draft attention filters.
- **Phase 3 — governance, security, budgets:** governance collection
  (default-branch protection + community-profile hygiene files) with new
  health rules; security alert reconciliation (code scanning, Dependabot,
  secret scanning — each independently capability-gated); daily organization
  budget sync; Governance and Budgets detail tabs. Migration 0002.
- **Phase 4 — GitLab provider:** group/subgroup project discovery, merge
  requests, pipelines, branch comparison, and webhook receiver
  (`/webhooks/gitlab`) with fingerprint idempotency. Configured via
  `GITLAB_TOKEN`, `GITLAB_GROUPS`, `GITLAB_BASE_URL`,
  `GITLAB_WEBHOOK_SECRET`. GitHub and GitLab repositories share every estate
  view.
- **Phase 5 — notifications:** outbound generic webhook
  (`NOTIFY_WEBHOOK_URL`) fired when a repository escalates to high/critical.
- Demo estate now includes a GitLab group, governance data, and budgets.

## [0.1.0] - 2026-07-12

### Added

- Initial application scaffold from the solution design pack:
  - Provider-neutral domain model with explainable health rules and
    FR-005 branch semantics (`current` / `work_pending` / `untracked_work` /
    `diverged` / `unknown`).
  - Capability model — missing data is a state, never a false zero.
  - GitHub provider adapter: App JWT (WebCrypto, PKCS#1→PKCS#8), installation
    tokens, REST client with rate-limit capture, webhook signature
    verification and event translation, bounded collectors.
  - D1 persistence: full schema (migration 0001), idempotent upserts,
    tombstone lifecycle, checkpointed sync jobs, webhook idempotency,
    retention compaction.
  - Cloudflare Worker (Hono): versioned JSON API, GitHub App OAuth login with
    allowlist + signed HttpOnly session cookies, webhook receiver, Cron-driven
    reconciliation and enrichment within free-tier budgets.
  - React SPA: Command Center with attention queue, repository inventory with
    filters and JSON export, repository detail tabs (overview, branches,
    pipelines, change requests, security, budgets), workspaces, platform
    health with manual sync, About & Credits, dark/light themes.
  - Demo mode with a synthetic estate evaluated by the real health engine.
  - Open-source baseline: Apache-2.0, NOTICE, third-party notices, credits
    (YAML + typed + in-product), security policy, contributing guide, CI.
