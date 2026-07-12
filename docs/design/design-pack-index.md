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

The private operations repository is **not** a private fork of the application and does not contain GitHub App private keys, GitLab tokens, session secrets, or copied production data. Secrets belong in Cloudflare secret storage; runtime inventory belongs in D1.

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
17. [Architectural decision records](adrs/)

## Current recommendation in one paragraph

Build RepoWrangler as a **single-repository, modular TypeScript solution** deployed as one Cloudflare Worker with static React assets. Use a GitHub App for read-only GitHub access, GitHub webhooks for near-real-time updates, small resumable reconciliation batches for correctness, D1 for snapshots and history, and a provider-neutral domain model so GitLab can be added without redesigning the application. Start single-tenant and read-only. Keep all code public under Apache-2.0, keep your live data and secrets outside the public repository, and maintain explicit third-party notices plus an in-product credits page for any reused source.
