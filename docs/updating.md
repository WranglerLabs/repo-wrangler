# Updating your instance

A RepoWrangler instance is self-hosted, so it does not auto-update — you update it
by pulling the latest code (or image) and restarting. Migrations apply
automatically on boot; there is no manual database step. After updating, the
running version is shown under the **RepoWrangler** title in the sidebar and on the
**About & Credits** page, and at `GET /health/live`.

## Docker Compose

```bash
git pull                       # get the latest code
docker compose up -d --build   # rebuild the image and restart
```

The `--build` flag is required — it recompiles with the new code. If you deploy a
pre-built image from a registry instead, pull the new tag and re-up:

```bash
docker compose pull && docker compose up -d
```

## Node server host

```bash
git pull
pnpm install                             # in case dependencies changed
pnpm --filter @repo-wrangler/web build   # rebuild the SPA
pnpm start:server                        # restart
```

## Cloudflare (Worker + D1)

```bash
git pull
pnpm install
pnpm deploy        # builds the SPA and runs wrangler deploy
```

## Kubernetes

Roll out the new image (built from `apps/server/Dockerfile`):

```bash
kubectl -n repo-wrangler set image deployment/repo-wrangler server=<new-image>
kubectl -n repo-wrangler rollout status deployment/repo-wrangler
```

## Which version am I on?

- **UI:** the `vX.Y.Z` under the sidebar title, and the badge on **About & Credits**.
- **API:** `GET /health/live` → `{"ok":true,"version":"X.Y.Z"}`.

Releases are tagged (`vX.Y.Z`) with notes in the [changelog](project/changelog.md).
Pin a self-hosted instance to a release by checking out that tag before you build.

## Notes

- **Demo mode** uses built-in mock data — there is no data migration to worry about
  on update; you simply get the newer app and demo estate.
- **Real mode** applies any new database migrations automatically at boot. Back up
  your database (or the SQLite file) before a major upgrade — see
  [operations](operations.md).
