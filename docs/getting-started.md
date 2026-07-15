# Getting started

This gets you from a clean clone to a running RepoWrangler in a few minutes.
Every path starts in **demo mode** — mock data, no secrets — so you can explore
the whole product before connecting anything.

## Prerequisites

- **Node 22** and **pnpm** (via `corepack enable`) for local development, or
- **Docker** for the one-command container path.

## Option A — one-command demo (Docker)

The fastest way to see the whole app on your machine:

```bash
git clone https://github.com/WranglerLabs/repo-wrangler.git
cd repo-wrangler
docker compose up
```

Open <http://localhost:8080>. You get the full UI populated with mock data — the
Command Center, Repositories, Branches, Change Requests, Security, Budgets &
Usage — with sign-in bypassed (a synthetic `demo` viewer). Nothing is written to
your GitHub or GitLab.

See [`deploy/docker/README.md`](../deploy/docker/README.md) for volumes and
options.

## Option B — local development (pnpm)

```bash
git clone https://github.com/WranglerLabs/repo-wrangler.git
cd repo-wrangler
corepack enable
pnpm install

# Cloudflare Worker dev server (Miniflare + local D1):
pnpm dev

# …or the Node host (SQLite, zero Cloudflare):
pnpm --filter @repo-wrangler/web build   # build the SPA the server serves
pnpm start:server
```

`pnpm dev` runs the Cloudflare Worker locally on <http://localhost:8787>.
`pnpm start:server` runs the Node host on <http://localhost:8080> (requires Node
22 — it uses `node:sqlite` behind `--experimental-sqlite`, which the script
passes). Both default to demo mode.

Useful workspace scripts (run from the repo root):

| Command | What it does |
|---|---|
| `pnpm -r typecheck` | Typecheck every package |
| `pnpm test` | Run the unit tests (vitest) |
| `pnpm --filter @repo-wrangler/web build` | Build the SPA to `apps/web/dist` |
| `pnpm dev` | Cloudflare Worker dev server |
| `pnpm start:server` | Node host (SQLite) |

## Going real

Demo mode never needs a secret. To monitor a real estate you connect a data
provider and turn off demo mode:

1. **Pick where to run it** — see the [deployment guide](deployment.md). The
   cheapest is the Cloudflare free tier; the simplest self-hosted is
   `docker compose`.
2. **Connect a provider:**
   - GitHub → [Providers → GitHub App](providers/github-app.md)
   - GitLab → [Providers → GitLab](providers/gitlab.md)
3. **Set `DEMO_MODE=false`** and provide the provider secrets (as Cloudflare
   secrets, a `.env` file, Key Vault, or a Kubernetes Secret depending on target
   — see [configuration](configuration.md)).
4. **Choose how people sign in** — GitHub (default) or
   [Microsoft Entra ID](providers/entra.md). Add yourself to the allowlist; the
   first person to sign in becomes the owner.

First sign-in and first sync are covered per provider in the provider guides, and
operationally in [operations.md](operations.md).

## Growing the estate

Your estate is never frozen at what you connected on day one. On **Estate Scope**:

- **Add more organizations / groups** — expand the disclosure row under a
  connection. For GitHub, *Install on another organization* opens your App's
  install page; after installing, *Check for new organizations* matches the
  App's installations and starts discovery automatically. For GitLab, add more
  groups to the existing token connection.
- **New since your last review** — repositories discovered after you last
  looked are listed at the top of Estate Scope. *Mark all reviewed* clears the
  list; anything found later shows up as new. Discovery also re-runs on a
  schedule, so repos created upstream surface here without any manual step.

## Next steps

- [Deployment guide](deployment.md) — choose and stand up a target.
- [Configuration reference](configuration.md) — every setting.
- [Architecture](architecture.md) — how the pieces fit.
- [Troubleshooting](troubleshooting.md) — if something doesn't come up.
