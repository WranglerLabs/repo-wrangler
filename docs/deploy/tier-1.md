# Tier 1 — Low-cost / managed

**Cost: ~a few $/mo.** For a small, always-on instance you don't want to babysit.
You've outgrown "it runs on my laptop" but don't yet need a full database or
multiple replicas — you want a managed host that stays up, patches itself, and
costs about the price of a coffee per month.

## Recipe

| Recipe | Topology | Where it runs | Backend |
|---|---|---|---|
| [`azure-container-apps`](../../deploy/azure-container-apps/) (SQLite mode) | Self-hosted | Azure Container Apps (consumption) | SQLite on Azure Files |

Azure Container Apps runs the same `apps/server` container that `docker compose
up` runs locally — no Cloudflare required — on managed serverless compute. In
SQLite mode it stores the database on an Azure Files share and pins a single
replica.

> **SQLite on Azure Files is for evaluation / light real use.** File locking over
> SMB is unreliable under restarts. Any instance meant to stay busy should move to
> **Postgres mode** — that's [Tier 2](tier-2). The recipe supports both from the
> same template; the only change is `postgres=true` plus a managed database.

## What you'll pay for

- **Azure Container Apps** — consumption pricing; near-free at idle, a few $/mo
  under light load.
- **A Standard_LRS storage account** for the Azure Files share (SQLite mode).
- **Key Vault** for the six secrets (managed-identity references, no secrets in
  env).

## Alternatives at this tier

Any small managed container host works the same way — a small VM, Fly, Railway,
or a Cloudflare paid plan if your estate outgrew the free Worker limits. They all
run the identical container; ACA is the recipe with a maintained
bicep + `deploy.ps1`/`deploy.sh`.

## Next step up

When one instance isn't enough — you need a real database, backups, or more than
one replica — switch to a managed PostgreSQL and you're at [Tier 2](tier-2), no
recipe change beyond `DATABASE_URL`.
