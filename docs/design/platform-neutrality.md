# RepoWrangler Architecture Addendum — Hosting & Platform Neutrality

> Authoritative design addendum. It amends the original solution design so that
> **no cloud provider, hosting platform, database, or deployment model is a hard
> requirement.** Cloudflare becomes the **reference implementation**, not the
> required one. The decision record is [ADR-013](../adr/ADR-013-platform-neutral-architecture.md).

## Objective

RepoWrangler is an open-source, self-hostable DevOps observability platform. The
architecture must support multiple deployment targets while keeping one consistent
user experience and feature set.

## Core principle — Deploy Anywhere. Own Your Data.

The system is designed with abstraction layers so deployment targets can be
swapped **without changing business logic**. Cloudflare is the reference
implementation only.

## Concerns that must be abstracted behind interfaces

UI · API · Background processing · Storage · Authentication · Scheduling · Secret
management · Cache · Logging. Business logic must never directly reference
Cloudflare, Azure, GitHub, etc.

### Provider interfaces

`IDataStore` · `ICacheProvider` · `ISecretProvider` · `IScheduler` ·
`IAuthenticationProvider` · `INotificationProvider` · `IRepositoryProvider` ·
`IContainerRegistryProvider` · `IBackgroundJobProvider`.

## Supported deployment targets

- **Zero cost / home lab:** Docker Compose, local SQLite, local dev, GitHub
  Codespaces, Dev Containers.
- **Low cost:** Cloudflare Workers + D1 + Pages, GitHub Pages (limited), Railway, Fly.io.
- **Azure:** Static Web Apps, Container Apps, App Service, Functions, Azure SQL,
  Azure PostgreSQL, Key Vault, Cache for Redis, Storage.
- **Enterprise:** Kubernetes, AKS, OpenShift, Docker Swarm, IIS, Linux containers,
  SQL Server, PostgreSQL, MySQL.

## Provider matrices

- **Repository providers:** GitHub (#1), GitLab; future Azure DevOps, Bitbucket,
  Gitea, Forgejo.
- **Storage:** SQLite, PostgreSQL, SQL Server, MySQL, Cloudflare D1.
- **Secrets:** environment variables, Cloudflare Secrets, Azure Key Vault, Docker
  Secrets, Kubernetes Secrets.
- **Scheduling:** Cloudflare Cron, GitHub Actions, Azure Functions Timer, Linux
  cron, Hangfire, Quartz.NET (future).
- **Authentication:** GitHub OAuth, GitLab OAuth, Microsoft Entra ID, Google,
  local development auth.

## Repository strategy

One public repo (`repo-wrangler`) with all application code. An optional private
`repo-wrangler-ops` holds **only** deployment docs, runbooks, environment notes,
inventory, and upgrade history — never application code, secrets, or production data.

## Cloudflare's role

Cloudflare remains the reference deployment for its free tier and developer
experience, but is not the required architecture. Every Cloudflare component must
sit behind an abstract interface with alternate implementations.

## Design goals

Deployable by hobbyists for free, by small teams at low cost, by enterprises on
their own infrastructure, in Azure-centric or Cloudflare-centric environments, or
fully self-hosted — **without changing application logic**.

## Documentation to keep in sync

Executive summary, solution architecture, platform requirements, security design,
ADRs, deployment guide, repository strategy, expected code structure, research
spikes, roadmap — all describe Cloudflare as the reference implementation, not a
requirement.
