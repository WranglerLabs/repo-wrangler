# Developer guide

How the monorepo is laid out and how to extend it. See
[architecture.md](architecture.md) for the design and [ADR index](adr/README.md)
for the decisions behind it.

## Prerequisites

- Node 22, `corepack enable` (pnpm from `packageManager`).
- `pnpm install` at the repo root.

## Layout

```
apps/
  web/      SPA (React + Vite)                — the UI
  worker/   Hono app: api / auth / webhooks / scheduled  — the backend
  server/   Node host shell (SQLite/PostgreSQL)          — zero-Cloudflare host
packages/
  domain/            provider-neutral entities + health rules
  contracts/         shared DTOs / validation
  provider-github/   GitHub data adapter
  provider-gitlab/   GitLab data adapter
  provider-mock/     mock data (demo mode)
  persistence-core/  storage seam (IDataStore)
  persistence-d1/    the SQL queries the API calls
  persistence-sqlite/   D1-compatible adapter over node:sqlite
  persistence-postgres/ D1-compatible adapter over PostgreSQL
  credits/  ui/  test-support/
migrations/   ordered *.sql applied at boot on every target
deploy/       per-target recipes (cloudflare, docker, azure-*, kubernetes, github-pages)
docs/         this documentation
```

## Everyday commands

| Command | Purpose |
|---|---|
| `pnpm -r typecheck` | Typecheck all packages. |
| `pnpm test` | Unit tests (vitest). |
| `pnpm --filter @repo-wrangler/web build` | Build the SPA. |
| `pnpm dev` | Cloudflare Worker dev server (Miniflare + local D1). |
| `pnpm start:server` | Node host (SQLite). |

## The seams (extend here, don't fork the core)

### Add a data provider

1. Create `packages/provider-<name>` implementing the provider port used by
   `provider-github`/`provider-gitlab` (discovery + entity mapping to the
   provider-neutral `domain` entities).
2. Wire configuration in `apps/worker/src/bindings.ts` (an `is<Name>Configured`
   helper) and pass values through `apps/server/src/env.ts` `buildEnv` for the
   Node host.
3. Map its webhooks under `apps/worker/src/webhooks/` if it has any.
4. Add tests and docs (`docs/providers/<name>.md`) and update the
   [capability matrix](provider-capability-matrix.md).

### Add a storage adapter

The persistence layer calls a D1-shaped handle (`prepare().bind().first/all/run`).
To add a database:

1. Create `packages/persistence-<db>` exposing `open<Db>D1(...)` returning a
   D1-compatible object and an `apply<Db>Migrations(...)`.
2. If the SQL dialect differs, follow `persistence-postgres`: keep the **shared
   `migrations/`** and query strings, and add (a) compatibility functions for
   SQLite-isms and (b) a small, **unit-tested** `translateSql`. Don't fork the ~60
   query sites.
3. Register it in `apps/server/src/store.ts` behind a config switch.
4. Verify with the same approach used for PostgreSQL (typecheck + translator tests
   + run representative queries against the real engine).

See [ADR-015](adr/ADR-015-postgres-storage-adapter.md) for the reference.

### Add an auth provider

`AUTH_MODE` selects the sign-in provider; each issues the **same signed session
cookie** so nothing downstream changes:

1. Add routes under `apps/worker/src/auth/<provider>.ts` (login + callback) that,
   on success, call `createSessionCookie(...)` with an allowlisted role.
2. Add config to `bindings.ts` + `apps/server` `buildEnv`, extend `authMode()`,
   and surface it in `/auth/config` so the SPA renders the right button.
3. Document it under `docs/providers/` and add an ADR.

See [ADR-016 / Entra](adr/ADR-016-entra-id-authentication.md) for the reference.

## Migrations

- Add a new file `migrations/NNNN_<slug>.sql` (next number, ordered). Use plain
  SQL that runs on SQLite, D1, and PostgreSQL — stick to the constructs already in
  use (`datetime('now')`, `ON CONFLICT … excluded`, integer-boolean columns).
- Migrations are **applied automatically at boot** and ledgered in `_migrations`;
  never edit an applied migration — add a new one.
- New camelCase result aliases or SQLite-only functions must be covered by the
  PostgreSQL translator/compat (add a `translateSql` test).

## Adding an endpoint

Add the route in `apps/worker/src/api/routes.ts`, the DTO in `contracts`, the
query in `persistence-d1`, and the SPA hook in `apps/web/src/api/client.ts`. Keep
it read-only ([ADR-008](adr/README.md)). Update [api.md](api.md).

## Testing & CI

- Unit tests live in each package's `test/` (`*.test.ts`, vitest).
- CI runs typecheck, tests, build, and CodeQL (`.github/workflows/`).
- The **doc quality gate**: a change that affects behavior/deploy/config/security/
  architecture must update the relevant docs (see [ROADMAP](../ROADMAP.md)
  DOC-quality-gate).

## Releases & ADRs

- Update [CHANGELOG.md](../CHANGELOG.md) and [ROADMAP.md](../ROADMAP.md).
- Bump `APP_VERSION` in `apps/worker/src/bindings.ts`.
- Record notable decisions as a new numbered ADR in
  [`docs/adr/`](adr/README.md) using the Context / Decision / Consequences format.
- See [CONTRIBUTING.md](../CONTRIBUTING.md).
