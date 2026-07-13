# RepoWrangler Solution Design Pack

**Solution:** RepoWrangler  
**Organization:** `Hybrid-Solutions-Cloud`  
**Status:** Architecture and planning baseline; no production code yet  
**Prepared:** 2026-07-11

> **RepoWrangler actively discovers, monitors, and helps manage repositories across GitHub and GitLab.**

This design pack defines the expected product, architecture, security model, free-tier deployment, provider integrations, user experience, open-source governance, attribution requirements, research spikes, architectural decisions, and implementation roadmap.

## Recommended repository model

| Repository | Visibility | Purpose |
|---|---|---|
| `Hybrid-Solutions-Cloud/repo-wrangler` | Public | Open-source product code, documentation, tests, database migrations, UI, Worker API, provider adapters, and release artifacts. |
| `Hybrid-Solutions-Cloud/repo-wrangler-ops` | Private, optional | Personal deployment notes, non-secret environment policy, expected organization/group inventory, runbooks, recovery procedures, and a pin to the deployed public release. |
| `Hybrid-Solutions-Cloud/gitactionboard` | Public fork, temporary | Upstream research and provenance for GitactionBoard. Archive after the reuse audit rather than immediately deleting it. |
| `Hybrid-Solutions-Cloud/git-pull-request-dashboard` | Public fork, temporary | Upstream research and provenance for Git Pull Request Dashboard. Archive after the reuse audit. |

The private operations repository is **not** a private fork of the application and does not contain GitHub App private keys, GitLab tokens, session secrets, or copied production data. Secrets belong in the deployment's secret store (`ISecretProvider` — environment variables, Docker/Kubernetes secrets, Cloudflare secrets, or Azure Key Vault); runtime inventory belongs in the configured `IDataStore` (SQLite, PostgreSQL, or D1).

## Documents

1. [Executive summary](00-executive-summary.md)
2. [Product requirements](01-product-requirements.md)
3. [Solution architecture](02-solution-architecture.md)
4. [Platform requirements](03-platform-requirements.md)
5. [Free-tier capacity and cost](04-free-tier-capacity-and-cost.md)
6. [Security and authentication](05-security-and-authentication.md)
7. [Data model and synchronization](06-data-model-and-synchronization.md)
8. [Dashboard and user experience](07-dashboard-and-user-experience.md)
9. [Repository and open-source strategy](08-repository-and-open-source-strategy.md)
10. [Upstream reuse and attribution](09-upstream-reuse-and-attribution.md)
11. [Research spikes](10-research-spikes.md)
12. [Roadmap and backlog](11-roadmap-and-backlog.md)
13. [Expected code structure](12-expected-code-structure.md)
14. [Diagrams and Lucid plan](13-diagrams-and-lucid-plan.md)
15. [Implementation readiness checklist](14-implementation-readiness-checklist.md)
16. [Sources](SOURCES.md)
17. [Architectural decision records](../adr/README.md)

## Governing architecture addenda (authoritative — read first)

These amend everything above and **govern where they differ**:

1. [Platform neutrality](platform-neutrality.md) ([ADR-013](../adr/ADR-013-platform-neutral-architecture.md)) — no cloud, host, database, or deployment model is a hard requirement; **Cloudflare is the reference implementation, not required**; everything is a provider (storage, scheduling, secrets, auth, cache, notifications, jobs, repositories).
2. [Documentation plan](documentation-plan.md) — RepoWrangler ships as a fully documented open-source product (complete `docs/` suite, quick-starts, deployment guides, architecture/diagrams, reference, operations, security, developer docs, quality gates).
3. [Infrastructure & deployment](infrastructure-deployment.md) — *Build Once. Deploy Anywhere.*; container-first; deployment Profiles A–E (local eval, home lab, Cloudflare reference, Azure, Kubernetes); self-hosted first-class; graceful offline behavior.

## Current recommendation in one paragraph

Build RepoWrangler as a **single-repository, modular TypeScript solution** with a provider-neutral core and swappable infrastructure adapters, so the same application runs unchanged on a laptop, a self-hosted container, Kubernetes, Azure, or Cloudflare. **Cloudflare Workers + D1 is the reference deployment, not a requirement** (see the addenda above). Use a GitHub App for read-only GitHub access, webhooks for near-real-time updates, small resumable reconciliation batches for correctness, an `IDataStore` (D1, SQLite, or PostgreSQL) for snapshots and history, and the provider-neutral domain model that already supports GitHub and GitLab. Start single-tenant and read-only. Keep all code public under Apache-2.0, keep live data and secrets outside the public repository, and maintain explicit third-party notices plus an in-product credits page for any reused source.
