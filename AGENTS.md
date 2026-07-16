# Contributor & agent guide

RepoWrangler is an open-source repository-estate dashboard: it discovers repos
across GitHub organizations/accounts and GitLab groups, evaluates their
operational health, and surfaces what needs attention on one screen. It is
**platform-neutral** (Deploy Anywhere, Own Your Data): infrastructure is a swappable
adapter, and a single Cloudflare Worker + D1 is the *reference* deployment, not a
requirement (see <https://wranglerlabs.org/design/platform-neutrality> and
<https://wranglerlabs.org/design/infrastructure-deployment>). It is **read-only** toward providers by design.

This file orients humans and AI coding agents working in the repo. It describes
only this project — there is no external configuration to fetch.

## Layout

- `apps/web` — React + Vite SPA (pure static bundle). Styling is token-based; see
  `apps/web/src/themes/` and <https://wranglerlabs.org/guide/theming>.
- `apps/worker` — Hono API, GitHub App OAuth, webhook receiver, Cron sync.
- `packages/domain` — provider-neutral entities, capability model, health rules.
- `packages/contracts` — shared API DTOs (zod).
- `packages/provider-github`, `packages/provider-gitlab`, `packages/provider-mock`
  — provider adapters (mock powers demo mode).
- `packages/persistence-d1` — D1 schema and idempotent upserts;
  `packages/persistence-core` — backend-neutral storage-port interfaces.
- `packages/ui` — framework-agnostic design tokens + capability presentation.
- `migrations/` — immutable SQL migrations.
- `deploy/` — per-host deployment recipes (see ADR-011).

Public documentation, ADRs, and the design pack are maintained in the private
`WranglerLabs/repo-wrangler-org` website-source repository and published at
<https://wranglerlabs.org>. Do not add a documentation site tree here.

## Commands

```bash
pnpm install
pnpm db:migrate:local        # local D1
pnpm dev                     # wrangler dev — demo mode needs no secrets
pnpm build                   # build the SPA
pnpm -r run typecheck
pnpm test                    # vitest
```

## Conventions

- TypeScript strict; `pnpm -r run typecheck` and `pnpm test` must pass.
- The domain and provider packages stay free of Cloudflare/runtime types so the
  core remains portable (SPIKE-014, ADR-011).
- Never render missing data as a false zero — use the capability model
  (`available` vs `not_authorized` vs `unsupported_*`).
- No provider **write** actions (ADR-008); the product is read-only.
- Commits: `type(scope): summary` (Conventional Commits).
- Never commit secrets, real database ids, or per-deployment values — the
  committed `wrangler.jsonc` holds placeholders only.
- This repository does not own or trigger Wrangler Labs environment builds or
  deployments. The private `repo-wrangler.dev` repository independently builds
  and deploys its pinned OSS release; HCS production is owned by its private
  instance repository.

## Key design decisions

See <https://wranglerlabs.org/adr/> and <https://wranglerlabs.org/design/design-pack-index>. Notable: provider-neutral
core (ADR-004), read-only App (ADR-003), webhooks + reconciliation (ADR-006),
host-agnostic frontend (ADR-011), drop-in theming (ADR-012).

## License

Apache-2.0. See `LICENSE`, `NOTICE`, and `CONTRIBUTING.md`.
