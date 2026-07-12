# Runbook — Upgrade a RepoWrangler deployment

Releases are tagged `vMAJOR.MINOR.PATCH` on `main`. Migrations are immutable
once released; new schema arrives only as new migration files, so upgrading is
always forward-only.

## Steps

1. **Read the release notes** (`CHANGELOG.md`) for the target version —
   especially new secrets/vars and new migrations.
2. **Pull the release:**

   ```bash
   git fetch --tags && git checkout vX.Y.Z
   pnpm install
   ```

3. **Apply new migrations** (safe to run when there are none):

   ```bash
   wrangler d1 migrations apply repo-wrangler --remote
   ```

4. **Set any new secrets/vars** called out in the changelog
   (`wrangler secret put NAME`, or vars in `wrangler.jsonc`).
5. **Verify locally, then deploy:**

   ```bash
   pnpm typecheck && pnpm test && pnpm build
   wrangler deploy
   ```

6. **Post-deploy checks:** `GET /health/live` reports the new version;
   `GET /health/ready` is `ok: true`; *Platform Health* shows connections
   `active` and no failed-job spike on the next sync ticks.

## Rollback

Redeploy the previous tag (`git checkout vPREV && pnpm build && wrangler
deploy`). Migrations are not rolled back — releases must tolerate a newer
schema than they created, which the compatibility policy guarantees for one
minor version. If a migration itself misbehaved, restore per
[recover-d1.md](recover-d1.md).
