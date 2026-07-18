# Changelog

All notable changes to RepoWrangler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project follows
semantic versioning.

## [Unreleased]

## [1.0.13] - 2026-07-18

### Fixed

- Fresh real-mode deployments now wait for public authentication state before
  mounting protected dashboard routes, preventing their initial API calls from
  racing setup discovery and redirecting to the normal sign-in page.
- The sign-in route now sends an unconfigured real deployment directly to the
  secure onboarding wizard instead of displaying an impossible “no sign-in
  method” dead end.
- Initial-routing regression tests cover setup redirection and prevent protected
  pages from rendering before setup state is known.

## [1.0.12] - 2026-07-18

### Fixed

- Release publication now continues to create the verified offline Linux image
  archive when GHCR package visibility blocks the independent anonymous-pull
  probe. Clone-free WSL and Remote Linux installers consume that immutable
  release asset and do not require registry credentials.

## [1.0.11] - 2026-07-18

### Fixed

- The web service worker no longer caches failed static-asset responses, which
  could leave an otherwise healthy WSL or Compose deployment showing only a
  blank dark page. The cache generation is advanced so affected browser caches
  are evicted, and the initial HTML now shows a visible startup diagnostic if
  the JavaScript application cannot mount.
- Release publication now verifies the digest-pinned server image using an
  anonymous GHCR token before creating deployment bundles or release assets, so
  a private package cannot be advertised as a clone-free public deployment.

### Documentation

- Updated the primary Ranch Hand path to `v0.1.0-rc.11`, adding ownership-safe
  in-product cleanup for orphaned WSL installation directories.
- Updated the primary Ranch Hand path to `v0.1.0-rc.10`, correcting Compose
  environment interpolation and enabling safe cleanup of affected rc.9 installs.
- Updated the primary Ranch Hand path to `v0.1.0-rc.9`, correcting Compose file
  transfer, refresh sessions, legacy recovery, and prerequisite diagnostics.
- Updated the primary Ranch Hand path to `v0.1.0-rc.8`, including partial WSL
  cleanup, correct plan identity, and managed-deployment visibility.
- Updated the primary Ranch Hand path to `v0.1.0-rc.7`, completing recovery of
  an exact empty WSL directory left before the ownership marker was written.
- Updated the primary Ranch Hand path to `v0.1.0-rc.6`, which recognizes and
  safely recovers its own interrupted WSL installation instead of reporting a
  generic directory collision.
- Updated the primary Ranch Hand path to `v0.1.0-rc.5`, including visible WSL
  install confirmation, progress, errors, and credential-free recovery controls.
- Updated the primary Ranch Hand path to `v0.1.0-rc.4`, including WSL collision
  safety and remote Linux Compose prepopulation.
- Updated the primary Ranch Hand path to `v0.1.0-rc.3`, separating local WSL
  Docker Compose from Docker Desktop and documenting the five deployment targets.
- Updated the primary Ranch Hand path to `v0.1.0-rc.2`; it now discovers and
  preselects the latest compatible stable RepoWrangler release, while
  prerelease and exact-version selection remain intentional choices.
- Designated Ranch Hand `v0.1.0-rc.1` as the Public Preview and primary
  recommended Windows deployment path, with manual clone/fork/artifact/CI
  deployment retained as the supported alternative.
- Documented the complete Ranch Hand GA promotion contract across signing,
  RepoWrangler compatibility, production configuration and target lifecycle,
  uninstall/data retention, application upgrades, real-target and accessibility
  UAT, security, documentation, and best-effort support.
- Replaced the retired bootstrap-script description with the separate Ranch Hand
  Windows lifecycle-manager path and preserved clone/fork/manual deployment as
  an equal supported option.
- Clarified that RepoWrangler releases contain server/deployment artifacts, while
  Ranch Hand Windows executables are distributed from the Ranch Hand repository.

## [1.0.10] - 2026-07-17

### Added

- Immutable clone-free deployment artifacts for Docker Compose, Azure Container
  Apps, and Cloudflare, each assembled from the exact release image and target
  metadata.
- A versioned release manifest containing exact byte counts, SHA-256 digests,
  compatibility metadata, SBOM location, and Sigstore provenance location for
  Ranch Hand and user-owned CI/CD consumers.
- Published SPDX SBOM, checksums, SLSA provenance, and a digest-pinned GHCR
  server image for the release.

### Changed

- The release workflow now rejects tag/package-version mismatches and refuses to
  overwrite an existing immutable manifest.

### Fixed

- PostgreSQL image digest resolution now consumes the complete Buildx inspection
  output, avoiding a `pipefail`/SIGPIPE failure before bundle assembly.

## [1.0.9] - 2026-07-17 — withdrawn

- The immutable tag and product image were created, but artifact publication
  stopped during PostgreSQL digest resolution before any GitHub Release or
  deployment manifest was published. The tag was intentionally not moved or
  deleted. `v1.0.9` is not a supported or installable release; use `v1.0.10`.

## [1.0.8] - 2026-07-16

### Fixed

- PostgreSQL server processes no longer load the SQLite adapter at startup, so
  PostgreSQL deployments do not emit SQLite warnings or paths in their boot log.

## [1.0.7] - 2026-07-16

### Changed

- The Azure Container Apps recipe now lists the region, resource group,
  registry, Key Vault, exact secret names, public URL, and naming inputs before
  the deployment steps begin.

## [1.0.6] - 2026-07-16

### Changed

- Estate Scope and Administration now expose a full-weight **Connect another
  platform** action instead of hiding the workflow in inline prose.

## [1.0.5] - 2026-07-16

### Added

- Estate Scope connection sections can be expanded and collapsed while keeping
  their status and workspace counts visible in the summary.

## [1.0.4] - 2026-07-16

### Added

- Workspaces now support search, provider/kind/attention/monitoring filters,
  multiple sort orders, selectable page sizes, and pagination for large estates.

## [1.0.3] - 2026-07-16

### Added

- Repositories now support provider, workspace, language, status, and attention
  filters plus name, attention, activity, synchronization, and pull-request
  sorting. Saved views preserve the expanded filter and sort definition.

## [1.0.2] - 2026-07-16

### Fixed

- Azure Container Apps now receives lowercase scheduler Boolean values, matching
  the application configuration parser.
- The ACA template accepts the custom hostname and managed-certificate name so
  repeat deployments preserve the production domain binding.
- Bash and PowerShell deployment scripts expose the scheduler and custom-domain
  parameters consistently.

## [1.0.1] - 2026-07-16

### Fixed

- The public Tier 2 Azure Container Apps recipe now includes the required
  `SECRET_ENCRYPTION_KEY` Key Vault reference and an explicit scheduler switch
  for safe staged revision cutovers. These settings had been proven in the HCS
  downstream deployment but were missing from the public GA recipe.

## [1.0.0] - 2026-07-16

RepoWrangler's first generally available release. The GitHub and GitLab estate
inventory, provider-neutral health model, secure first-boot flow, native sign-in,
portable deployment recipes, SQLite/D1/PostgreSQL storage options, and production
operations baseline have passed the GA release gate.

### Added

- **Secure first boot:** a fresh real-mode instance enters a narrowly scoped
  setup mode so the onboarding wizard can configure the first sign-in provider
  without a pre-existing session. Operators may protect this flow with
  `SETUP_TOKEN`; setup access closes as soon as a real provider is usable.
- **Build-derived versioning:** `APP_VERSION` can override the checked-in package
  version at runtime, and container builds accept `--build-arg APP_VERSION=<tag>`.
- **Account menu:** the sidebar identity control now shows the active provider,
  role, and sign-out action in one consistent menu.

### Changed

- **Public documentation ownership:** the complete VitePress documentation
  source, assets, dependencies, and Cloudflare deployment workflow now live in
  the private `WranglerLabs/repo-wrangler-org` website repository. This public
  repository contains the open-source product code only; published docs remain
  available at <https://wranglerlabs.org>.
- **Environment deployment ownership:** the public demo deployment trigger was
  removed from this repository. The private `WranglerLabs/repo-wrangler.dev`
  repository independently owns its release lock, build, and Cloudflare
  deployment workflow.

### Fixed

- **GitLab enrichment queue starvation (B11):** provider authentication and
  discovery succeeded, but repository enrichment was capped at three jobs every
  15 minutes. Large estates accumulated hundreds of pending jobs, leaving branch,
  pipeline, and merge-request data empty for hours. Periodic reconciliation now
  runs every five minutes and consumes up to ten jobs per invocation while
  retaining the subrequest-budget safety boundary.

- Signed sessions now record their issuing provider. Disabling or removing an
  auth provider invalidates its sessions immediately; legacy provider-less
  cookies are rejected.
- Dependency auditing works again after upgrading the project toolchain to
  pnpm 11. Known Vite and esbuild advisories are remediated with targeted
  overrides, lifecycle scripts use an explicit allowlist, and CI now enforces
  both a frozen lockfile and a clean audit.

### Release verification

- Dependency audit: no known vulnerabilities.
- TypeScript: all 16 typed workspace projects passed.
- Tests: 189 passed across 33 test files.
- Production web build: passed.
- Database migrations: unchanged from v0.6.10; all five existing migrations
  remain immutable.

## [0.6.10] - 2026-07-14

First release under **Wrangler Labs** — the project moved to
`WranglerLabs/repo-wrangler` (full history preserved) and rebranded; marketing
and public docs now share https://wranglerlabs.org and the public demo is at
https://repowrangler.dev. Consolidates the `v0.5.1-rc1`…`v0.6.10-rc1`
hardening series. See the [v0.6.10 release notes](https://wranglerlabs.org/releases/v0.6.10).

### Added

- **Sign out:** the sidebar footer now shows a *Sign out* button under the
  signed-in user — it ends the session server-side (`POST /auth/logout`,
  audited) and returns to the sign-in screen. Previously the UI had no way
  to leave a session or reach `/sign-in` while a session cookie existed.

- **Grow the estate (onboarding Phase C):** Estate Scope gains an *Add more
  organizations / groups* flow per connection — deep-link to the GitHub App's
  install page, then *Check for new organizations* matches installations and
  starts discovery; GitLab groups can be added to the existing connection.
- **New since last review:** Estate Scope surfaces repositories discovered
  after the operator's last review, with *Mark all reviewed* advancing the
  marker (`GET /estate/new-since-review`, `POST /estate/mark-reviewed`).
- Getting-started guide: new "Growing the estate" section.

### Fixed

- **GitLab discovery never ran on wizard-connected instances:** creating a
  GitLab connection (and selecting groups) enqueued the *GitHub* discovery
  job type, and the only other `gitlab_discovery` enqueue sites were the
  03:17 UTC maintenance tick and an interval-gated periodic check — so a
  fresh GitLab connection produced workspaces with zero projects and zero
  errors. Connect, group-select, and admin *Sync now* all enqueue
  `gitlab_discovery` now.

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
  [public documentation](https://wranglerlabs.org/getting-started) — getting-started, deployment (capability matrix +
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
  per browser). See the [theming guide](https://wranglerlabs.org/guide/theming).
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
  including the org-owner 404 and how to avoid it ([GitHub App setup](https://wranglerlabs.org/setup/github-app)).

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
  reconnect), and [research spike outcomes](https://wranglerlabs.org/research/).
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
