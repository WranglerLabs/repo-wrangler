# Runbook — Back up and recover the D1 database

RepoWrangler's D1 database holds inventory snapshots, sync state, sessions,
and audit metadata — no provider tokens. Everything in it can be rebuilt from
the providers, so the worst-case recovery is a clean re-discovery.

## Back up

```bash
wrangler d1 export repo-wrangler --remote --output backup-$(date +%Y%m%d).sql
```

Store the export privately: it contains your repository inventory and health
history. Do not commit it to any repository.

## Restore into a fresh database

1. Create the database and apply migrations:

   ```bash
   wrangler d1 create repo-wrangler
   # update database_id in wrangler.jsonc with the new id
   wrangler d1 migrations apply repo-wrangler --remote
   ```

2. Import the backup:

   ```bash
   wrangler d1 execute repo-wrangler --remote --file backup-YYYYMMDD.sql
   ```

3. Redeploy (`pnpm build && wrangler deploy`) and check `GET /health/ready`.

## Recover with no usable backup

1. Create the database and apply migrations as above.
2. Deploy, sign in, and run **Run discovery now** from *Administration* (or
   wait for the next scheduled reconciliation).
3. Discovery, enrichment, governance, security, and billing sync rebuild the
   estate over the following cycles. History (pipeline runs, closed change
   requests, budget snapshots) restarts from now — current-state pages are
   complete once enrichment finishes.

## Point-in-time note

D1 also has Time Travel (`wrangler d1 time-travel`) for restoring a database
to a recent point in time without an export — prefer it for accidental-write
recovery when the incident is fresh.
