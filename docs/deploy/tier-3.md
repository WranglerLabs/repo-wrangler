# Tier 3 — Enterprise

**Cost: varies.** For a hardened, highly-available instance: separated
controller/worker processes, private networking, an HA database, SSO/RBAC, and
full observability.

> **Tier 3 is a target state, not a copy-ready recipe yet.** The foundations it
> builds on already ship — the multi-replica PostgreSQL storage adapter, the
> external scheduler driver, the Kubernetes Helm chart, Key Vault / Vault / AWS /
> GCP secret adapters, and the Entra/Google/GitLab SSO adapters. What's net-new is
> the hardened topology that composes them. Those pieces are tracked on the public
> [ROADMAP.md](../../ROADMAP.md); this page describes where they're headed.

## What defines this tier

- **Separated controller / workers** — split the single all-in-one process into a
  request-serving tier and a background/scheduler tier that scale independently.
  Today every topology runs one process that serves the SPA, the API, and the
  scheduler together; the [external scheduler driver](../adr/ADR-018-scheduler-drivers.md)
  already lets you run N stateless API replicas with one external ticker, which is
  the groundwork.
- **HA database** — a highly-available PostgreSQL topology (replicas, failover)
  behind the same `DATABASE_URL` seam Tier 2 introduced.
- **Private networking** — the instance and its database on a private network, no
  public database endpoint, ingress terminated at a gateway/WAF.
- **SSO / RBAC hardening** — enforce SSO ([Entra/Google/GitLab adapters](../providers/entra))
  and scoped, role-based views. Role-based multi-user access is itself a roadmap
  item ("Multi-user views").
- **Observability** — metrics, tracing, and log aggregation wired to your stack.

## Already available to build on

| Foundation | Status | Reference |
|---|---|---|
| Multi-replica PostgreSQL storage | ✅ shipped | [ADR-015](../adr/ADR-015-postgres-storage-adapter.md) |
| External scheduler driver (`POST /internal/cron/run`) | ✅ shipped | [ADR-018](../adr/ADR-018-scheduler-drivers.md) |
| Kubernetes manifests + Helm chart | ✅ shipped | [`deploy/kubernetes`](../../deploy/kubernetes/) |
| Key Vault / Vault / AWS / GCP secrets | ✅ shipped | [ADR-017](../adr/ADR-017-secret-provider-seam.md) |
| SSO adapters (Entra, Google, GitLab) | ✅ shipped | [ADR-019](../adr/ADR-019-authentication-provider-registry.md) |
| Controller/worker split, HA DB, private net, RBAC, observability | 🚧 roadmap | [ROADMAP.md](../../ROADMAP.md) |

If you need an enterprise deployment today, start from [Tier 2](tier-2)
(Kubernetes + managed Postgres) and layer your own HA, networking, and
observability on top — then track the roadmap for the recipes that will formalize
this tier.
