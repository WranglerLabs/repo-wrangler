# RepoWrangler Solution Design Pack

**Solution:** RepoWrangler  
**Organization:** `WranglerLabs`  
**Status:** Architecture and planning baseline; no production code yet  
**Prepared:** 2026-07-11

> **RepoWrangler actively discovers, monitors, and helps manage repositories across GitHub and GitLab.**

This design pack defines the expected product, architecture, security model, free-tier deployment, provider integrations, user experience, open-source governance, attribution requirements, research spikes, architectural decisions, and implementation roadmap.

## Recommended repository model

| Repository | Visibility | Purpose |
|---|---|---|
| `WranglerLabs/repo-wrangler` | Public | Open-source product code, documentation, tests, database migrations, UI, Worker API, provider adapters, and release artifacts. |
| `WranglerLabs/wrangler-ops` | Private | Project PMO, deployment notes, non-secret environment policy, expected organization/group inventory, runbooks, recovery procedures, and deployed-release records. |
| `WranglerLabs/gitactionboard` | Public fork, temporary | Upstream research and provenance for GitactionBoard. Archive after the reuse audit rather than immediately deleting it. |
| `WranglerLabs/git-pull-request-dashboard` | Public fork, temporary | Upstream research and provenance for Git Pull Request Dashboard. Archive after the reuse audit. |

The private operations repository is **not** a private fork of the application and does not contain GitHub App private keys, GitLab tokens, session secrets, or copied production data. Secrets belong in the deployment's secret store (`ISecretProvider` — environment variables, Docker/Kubernetes secrets, Cloudflare secrets, or Azure Key Vault); runtime inventory belongs in the configured `IDataStore` (SQLite, PostgreSQL, or D1).

## Documents

The full design pack is consolidated into a single document:

- **[RepoWrangler Solution Design](RepoWrangler-Solution-Design.md)** — the complete
  pack, covering the executive summary, product requirements, solution
  architecture, platform requirements, free-tier capacity and cost, security and
  authentication, data model and synchronization, dashboard and user experience,
  repository and open-source strategy, upstream reuse and attribution, research
  spikes, roadmap and backlog, expected code structure, diagrams and Lucid plan,
  implementation readiness checklist, sources, and the architectural decision
  records (ADR-001…010).
- **[Core decisions](core-decisions.md)** — the distilled decision summary.
- **[Architectural decision records](../adr/)** — ADR-001 onward,
  including the post-design ADR-011…016.

For deployer- and contributor-facing documentation (not design history), start at
the **[documentation index](../README.md)**.

## Governing architecture addenda (authoritative — read first)

These amend everything above and **govern where they differ**:

1. [Platform neutrality](platform-neutrality.md) ([ADR-013](../adr/ADR-013-platform-neutral-architecture.md)) — no cloud, host, database, or deployment model is a hard requirement; **Cloudflare is the reference implementation, not required**; everything is a provider (storage, scheduling, secrets, auth, cache, notifications, jobs, repositories).
2. [Documentation plan](documentation-plan.md) — RepoWrangler ships as a fully documented open-source product (complete `docs/` suite, quick-starts, deployment guides, architecture/diagrams, reference, operations, security, developer docs, quality gates).
3. [Infrastructure & deployment](infrastructure-deployment.md) — *Build Once. Deploy Anywhere.*; container-first; deployment Profiles A–E (local eval, home lab, Cloudflare reference, Azure, Kubernetes); self-hosted first-class; graceful offline behavior.

## Current recommendation in one paragraph

Build RepoWrangler as a **single-repository, modular TypeScript solution** with a provider-neutral core and swappable infrastructure adapters, so the same application runs unchanged on a laptop, a self-hosted container, Kubernetes, Azure, or Cloudflare. **Cloudflare Workers + D1 is the reference deployment, not a requirement** (see the addenda above). Use a GitHub App for read-only GitHub access, webhooks for near-real-time updates, small resumable reconciliation batches for correctness, an `IDataStore` (D1, SQLite, or PostgreSQL) for snapshots and history, and the provider-neutral domain model that already supports GitHub and GitLab. Start single-tenant and read-only. Keep all code public under Apache-2.0, keep live data and secrets outside the public repository, and maintain explicit third-party notices plus an in-product credits page for any reused source.
