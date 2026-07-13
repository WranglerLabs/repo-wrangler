# RepoWrangler Infrastructure Design Addendum — Local, Self-Hosted & Portable Deployments

> Authoritative design addendum. Extends [platform-neutrality.md](platform-neutrality.md)
> ([ADR-013](../adr/ADR-013-platform-neutral-architecture.md)) to the infrastructure and
> deployment layer. **Design to implement on the owner's command — not a schedule.**

## Objective & principle — Build Once. Deploy Anywhere.

RepoWrangler must run anywhere from a developer laptop to an enterprise Kubernetes
cluster. No hosting provider, cloud platform, operating system, or orchestration
technology is mandatory. Infrastructure choices are **implementation details, not
architectural constraints** — the same application architecture runs on every model,
differing only in the infrastructure beneath it.

## Deployment models (no application-code changes between them)

- **Local development** — Windows, Linux, macOS; native, Docker Compose, Dev Containers,
  GitHub Codespaces. Minimal setup, complete working environment.
- **Single computer** — desktop, laptop, Intel NUC, Raspberry Pi (future eval), home
  server, mini PC, VM. Docker Compose preferred (Podman Compose future); native optional.
  As few external dependencies as possible.
- **Small team** — single Docker host, multiple containers, external PostgreSQL or SQLite,
  optional reverse proxy.
- **Enterprise** — Kubernetes, AKS, OpenShift, Docker Swarm (best effort), generic Linux
  containers, Azure Container Apps, Azure App Service, Cloudflare (reference). Supports HA,
  horizontal scaling, rolling upgrades, centralized logging, external identity, external DBs.

## Deployment profiles (define, document, and validate each)

| Profile | Target | Purpose |
|---|---|---|
| **A — Local evaluation** | Docker Compose + SQLite + env vars | Learn / develop / test |
| **B — Home lab** | Docker Compose + PostgreSQL + reverse proxy | Continuous personal use, many orgs, GitLab, long-running |
| **C — Cloudflare (reference)** | Workers + D1 + static assets | Low-cost cloud — **reference, not required** |
| **D — Azure** | Static Web Apps (where apt) + Container Apps / App Service + PostgreSQL/Azure SQL + Key Vault | Azure-centric orgs |
| **E — Kubernetes** | Any CNCF-conformant cluster | Enterprise, MSP, large orgs |

## Container-first design

Ship as a container-first application: `Dockerfile`, `docker-compose.yml`,
`docker-compose.override.yml`, a development compose file, and a production compose file.
Future: Helm chart, Kubernetes manifests, OpenShift manifests.

## Infrastructure abstractions (replaceable)

- **Database:** SQLite · PostgreSQL · SQL Server · MySQL · D1
- **Cache:** memory · Redis · KV-compatible
- **Scheduling:** internal scheduler · cron · cloud scheduler · Kubernetes CronJob
- **Secrets:** environment variables · Docker Secrets · Kubernetes Secrets · cloud secret stores
- **Storage:** local filesystem · cloud object storage · network storage

(These map to the ADR-013 provider interfaces: `IDataStore`, `ICacheProvider`,
`IScheduler`, `ISecretProvider`, and a storage provider.)

## Self-hosted, first-class

Self-hosted deployments get the **same documentation and engineering attention** as cloud.
The project must never assume internet connectivity, cloud services, managed databases,
managed identity, or proprietary infrastructure. A user must be able to deploy RepoWrangler
**entirely within their own environment.**

## Offline / degraded behavior (document expected behavior when…)

GitHub unreachable · GitLab unreachable · no internet · webhooks not receivable · scheduled
sync delayed. The app must **degrade gracefully and clearly indicate synchronization
status** (the capability + freshness model already distinguishes stale/unavailable from zero).

## Infrastructure documentation (per the documentation plan)

Local installation · Docker Compose · self-hosted · home lab · Kubernetes · Azure ·
Cloudflare · and a **migration guide between deployment models** (e.g. SQLite→PostgreSQL,
Docker→Kubernetes, Cloudflare→Azure).

## Architecture diagrams to add

Local laptop · single-server Docker · home lab · cloud · Kubernetes — each showing that all
models execute the **same application architecture** and differ only in the infrastructure
components beneath them.

## Long-term goal

Deployable on a developer laptop, home server, small-business server, Docker, Kubernetes,
Azure, Cloudflare, another cloud, or an enterprise datacenter — **without changing
application logic or source code.**
