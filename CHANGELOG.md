# Changelog

All notable changes to RepoWrangler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project follows
semantic versioning.

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
