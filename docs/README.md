# RepoWrangler documentation

RepoWrangler is an open-source, single-tenant **repository estate command
center**: it discovers every repository across your GitHub (and GitLab) estate,
tracks branch/PR/pipeline/security/budget health, and surfaces what needs
attention — read-only, no write actions against your providers. It is
**platform-neutral** (ADR-013): the same product runs on Cloudflare, a
self-hosted container, Azure, or Kubernetes, and every deployment starts in
**demo mode** (mock data, no secrets) so you can see the whole app before wiring
anything up.

## Start here

| I want to… | Read |
|---|---|
| See it running in one command | [Getting started](getting-started.md) |
| Choose where to deploy it | [Deployment guide](deployment.md) + [capability matrix](provider-capability-matrix.md) |
| Connect my GitHub estate | [Providers → GitHub App](providers/github-app.md) |
| Connect GitLab | [Providers → GitLab](providers/gitlab.md) |
| Sign in with Microsoft Entra ID | [Providers → Entra ID](providers/entra.md) |
| Configure every setting | [Configuration reference](configuration.md) |
| Understand how it's built | [Architecture](architecture.md) |
| Call the API | [API reference](api.md) |
| Run it in production | [Operations & runbooks](operations.md) |
| Understand the security model | [Security](security.md) |
| Contribute or extend it | [Developer guide](developer.md) |
| Fix a problem | [Troubleshooting](troubleshooting.md) |

## Documentation map

- **Getting started** — [getting-started.md](getting-started.md): the fastest path
  to a running instance (demo, then real).
- **Deployment** — [deployment.md](deployment.md): pick a target (Cloudflare,
  Docker, Azure Container Apps, Kubernetes, decoupled SPA), with a capability
  matrix and a decision flowchart. Per-target recipes live under
  [`deploy/`](../deploy/).
- **Configuration** — [configuration.md](configuration.md): every environment
  variable / binding, what sets it per target, and which are secret.
- **Providers** — how to connect each data/identity provider:
  [GitHub App](providers/github-app.md), [GitLab](providers/gitlab.md),
  [Entra ID sign-in](providers/entra.md).
- **Architecture** — [architecture.md](architecture.md): C4-style context /
  container / component views, the storage and auth seams, and the ADR index.
- **Reference** — [API](api.md), [service catalog](service-catalog.md),
  [capability matrix](provider-capability-matrix.md), the database schema
  (`migrations/`), and the [design pack](design/design-pack-index.md).
- **Operations** — [operations.md](operations.md): sync, backup/restore, disaster
  recovery, upgrades, migrations, plus the runbooks under
  [`operations/`](operations/).
- **Security** — [security.md](security.md): trust boundaries, secret storage per
  target, read-only guarantee, webhook verification, vulnerability reporting.
- **Developer** — [developer.md](developer.md): monorepo layout, how to add a
  provider / storage adapter / auth provider, migrations, releases, ADRs.
- **Decisions** — [ADR index](adr/): the architectural decision records.

## Project docs

Governance and contribution docs live at the repository root:
[README](../README.md), [ROADMAP](../ROADMAP.md), [CHANGELOG](../CHANGELOG.md),
[CONTRIBUTING](../CONTRIBUTING.md), [SECURITY](../SECURITY.md),
[CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md), [GOVERNANCE](../GOVERNANCE.md),
[SUPPORT](../SUPPORT.md).
