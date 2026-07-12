# Changelog

All notable changes to RepoWrangler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project follows
semantic versioning.

## [Unreleased]

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
