# Operations & runbooks

Running a RepoWrangler instance day to day. Task-specific runbooks live under
[`operations/`](operations/); this page is the index plus the backup/restore,
disaster-recovery, upgrade, and migration procedures.

## Runbooks

| Runbook | When |
|---|---|
| [Reconnect a provider](operations/reconnect-provider.md) | A provider connection is failing/expired. |
| [Rotate the GitHub App key](operations/rotate-github-app-key.md) | Periodic rotation or suspected exposure. |
| [Recover D1](operations/recover-d1.md) | Cloudflare D1 data recovery. |
| [Upgrade](operations/upgrade.md) | Moving to a new version. |

## Sync

- **Automatic:** the scheduler runs incremental sync every 15 minutes
  (`*/15 * * * *`) and a daily reconciliation (`17 3 * * *`); webhooks drive
  near-real-time updates.
- **Manual:** an admin can trigger an immediate sync from the Administration page
  (`POST /api/v1/admin/sync`).
- **Multi-replica:** with PostgreSQL and more than one replica, run the in-process
  scheduler on exactly **one** replica — set `ENABLE_SCHEDULER=false` on the rest
  (the recipes note this).
- **Observability:** `GET /api/v1/platform-health` reports sync-job state, webhook
  delivery counts (24h), and provider connection health.

## Backup & restore

Back up **the database** — it is the only stateful component. Config/secrets live
in your platform's secret store and are reproducible.

### SQLite (Node host / Docker / Container Apps / Kubernetes)

The database is a single file (`SQLITE_PATH`, default `data/repo-wrangler.db`).

```bash
# Backup (consistent copy; sqlite3 handles the WAL)
sqlite3 /app/data/repo-wrangler.db ".backup '/backup/repo-wrangler-$(date +%F).db'"

# Restore: stop the container, replace the file, start again
cp /backup/repo-wrangler-2026-07-13.db /app/data/repo-wrangler.db
```

For Docker, back up the named volume (`rw-data`). For Azure Container Apps, the
file lives on the mounted **Azure Files** share — enable share snapshots/backup.
For Kubernetes, snapshot the **PVC** (VolumeSnapshot) or `sqlite3 .backup` to
object storage on a CronJob.

### PostgreSQL

Use your provider's managed backups (Azure Database for PostgreSQL automated
backups / point-in-time restore), or `pg_dump`/`pg_restore`:

```bash
pg_dump "$DATABASE_URL" -Fc -f repo-wrangler-$(date +%F).dump
pg_restore -d "$DATABASE_URL" --clean --if-exists repo-wrangler-2026-07-13.dump
```

### Cloudflare D1

Use Wrangler's D1 export / time-travel; see
[recover-d1](operations/recover-d1.md).

## Disaster recovery

RepoWrangler is a **derived** view of your providers — its data can be rebuilt by
re-syncing. Recovery order:

1. **Redeploy** the instance from the repo (or your ops repo) to any target — the
   image/code is stateless.
2. **Restore secrets** from your secret store; set `PUBLIC_BASE_URL` and provider
   config.
3. **Restore the database** from backup for immediate history, **or** start empty
   and let sync rebuild the snapshot from the providers.
4. **Re-point webhooks** if the URL changed.

Because deletion is modeled as tombstones (never destructive) and sync is
idempotent, a rebuild converges to the correct estate state.

## Migrations

Schema migrations in [`migrations/`](../migrations/) are **applied automatically
at boot** on every target (D1 via the deploy pipeline, the Node host via the
storage adapter, idempotently ledgered in `_migrations`). Deployers never run a
migration by hand. The same files serve SQLite, D1, and PostgreSQL — PostgreSQL
adds compatibility functions first (see
[ADR-015](adr/ADR-015-postgres-storage-adapter.md)). Adding a migration is covered
in the [developer guide](developer.md#migrations).

## Upgrades

See [operations/upgrade.md](operations/upgrade.md). In short: pull the new
version, redeploy (migrations auto-apply), verify `/health/ready` and
`/api/v1/platform-health`. Back up the database first.

## Retention & compaction

`DEFAULT_RETENTION_DAYS` bounds pipeline-run and webhook-delivery history; the
daily job compacts beyond it. Tombstoned repositories are retained for audit.
