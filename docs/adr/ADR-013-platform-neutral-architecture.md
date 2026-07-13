# ADR-013 — Platform-neutral architecture

- **Status:** Accepted
- **Date:** 2026-07-12
- **Supersedes emphasis of:** ADR-001 (Cloudflare Workers runtime) — Cloudflare is
  now explicitly the *reference* implementation, not the required one.
- **Amends:** the design's "Portability" section; formalizes
  [docs/design/platform-neutrality.md](../design/platform-neutrality.md).

## Context

RepoWrangler is an open-source, self-hostable platform. The original design named
Cloudflare as the first hosting target and required core packages to stay
Cloudflare-free, but in practice the only shipped backend adapter is Cloudflare/D1
and the API is wired directly to D1 — so the product cannot yet be deployed without
Cloudflare. That contradicts the product's purpose: hobbyists, Azure-centric
enterprises, and fully self-hosted operators must all be able to run it.

## Decision

**No cloud provider, hosting platform, database, or deployment model is a hard
requirement.** Every infrastructure concern is expressed as an interface, with
Cloudflare as one implementation among several. Business logic (domain, providers,
API handlers) MUST NOT reference any vendor SDK or type directly.

Abstraction interfaces (owned by `packages/` core, implemented by adapters):

| Interface | Purpose | Reference impl | Other targets |
|---|---|---|---|
| `IDataStore` | Persistence | Cloudflare D1 | SQLite, PostgreSQL, SQL Server, MySQL |
| `IScheduler` | Periodic sync | Cloudflare Cron | Linux cron, GitHub Actions, Azure Timer |
| `ISecretProvider` | Secret access | Cloudflare Secrets | env vars, Azure Key Vault, Docker/K8s secrets |
| `IAuthenticationProvider` | Sign-in | GitHub OAuth | GitLab OAuth, Entra ID, Google, local dev |
| `ICacheProvider` | Cache | in-memory / none | Redis / Azure Cache |
| `INotificationProvider` | Escalations | generic webhook | Teams, Slack, Discord, email |
| `IRepositoryProvider` | Estate source | GitHub | GitLab; future Azure DevOps, Bitbucket, Gitea, Forgejo |
| `IBackgroundJobProvider` | Job execution | Cron-driven batches | Hangfire, Quartz, queue workers |
| `IContainerRegistryProvider` | (future) images | — | ACR, GHCR, Docker Hub |

Deployment targets the architecture must support: Docker Compose / local SQLite /
Codespaces (zero cost); Cloudflare / Railway / Fly.io (low cost); Azure SWA +
Container Apps / App Service / Functions + Azure SQL/PostgreSQL + Key Vault
(Azure); Kubernetes / AKS / OpenShift / SQL Server / PostgreSQL / MySQL
(enterprise).

## Consequences

**Positive** — the product matches its mission: deploy anywhere, own your data;
Azure and self-hosted operators are first-class; no vendor lock-in.

**Cost** — more interfaces and adapters to build and test; a per-interface adapter
matrix in CI; documentation must describe targets without implying a default is required.

**Migration** — this is a phased refactor (see ROADMAP "Platform neutrality"): wire
the API through `IDataStore`/`persistence-core` (D1 + SQLite/Postgres adapters),
then abstract scheduling, secrets, and auth, then add per-target deploy recipes.
Current state: `persistence-core` (the `IDataStore` seam) and a D1-compatible SQLite
adapter exist; the API is not yet wired through the seam, and scheduler/secret/auth
are still Cloudflare-shaped.
