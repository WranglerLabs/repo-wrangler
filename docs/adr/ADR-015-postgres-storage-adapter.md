# ADR-015: PostgreSQL storage adapter

- **Status:** Accepted
- **Date:** 2026-07-13
- **Relates to:** [ADR-005 (D1 storage)](README.md),
  [ADR-013 (platform-neutral architecture)](ADR-013-platform-neutral-architecture.md),
  [ADR-014 (Node server host)](ADR-014-node-server-host.md)

## Context

ADR-014 gave RepoWrangler a Node host that runs the whole backend on an embedded
SQLite file. That is perfect for a single container, but SQLite is single-writer:
it pins a self-hosted deployment to **one replica**. Larger estates, and any
deployment that wants two or more API replicas behind a load balancer (Azure
Container Apps scale-out, a Kubernetes `Deployment` with `replicas > 1`), need a
**shared** database. PostgreSQL is the obvious target — ubiquitous, managed on
every cloud (Azure Database for PostgreSQL, RDS, Cloud SQL), and free to self-host.

The whole persistence layer (`@repo-wrangler/persistence-d1`) is written once, in
SQLite/D1 dialect, and is called directly across ~60 sites in the API as
`c.env.DB` (a `D1Database`). A rewrite per database would be a large, risky change
to code that is already correct.

## Decision

Add `@repo-wrangler/persistence-postgres`: a **D1-compatible adapter over
PostgreSQL** (the `pg` driver), selected at the host by setting `DATABASE_URL`.
It presents the exact `prepare().bind().first()/.all()/.run()` surface the
persistence layer uses, so the domain, providers, API, and UI run **unchanged** —
the same trick ADR-014's SQLite adapter uses.

Three small, well-scoped mechanisms bridge the SQLite/PostgreSQL dialect gap
instead of forking the SQL:

1. **Compatibility functions.** `datetime('now')` and `datetime('now', <modifier>)`
   are installed as real PostgreSQL SQL functions that return the same
   `YYYY-MM-DD HH:MM:SS` UTC text SQLite produces; SQLite date modifiers
   (`'-7 days'`, `'+30 minutes'`) are already valid PostgreSQL `interval` inputs.
   Because these functions exist, the **same `migrations/*.sql` files** and the
   same query strings serve both engines — the DDL's `DEFAULT (datetime('now'))`
   clauses just work.
2. **A tiny SQL translator** (`translateSql`, pure and unit-tested) that rewrites
   the three constructs that genuinely differ: `?N` → `$N` placeholders;
   `INSERT OR IGNORE` → `INSERT … ON CONFLICT DO NOTHING`; and quoting of any
   column alias containing an upper-case letter (`AS openCrs` → `AS "openCrs"`)
   so PostgreSQL's identifier down-casing does not break `row.openCrs` reads.
3. **`int8` → number.** `COUNT(*)` returns `bigint`, which `pg` yields as a
   string; a type parser converts it back to a JS number to match SQLite/D1.

Migrations auto-apply at boot inside a transaction, ledgered in `_migrations` —
the same idempotent flow as SQLite, so the deployer never runs a migration by hand.

## Consequences

- **Positive:** self-hosted deployments can now run **multiple replicas** against
  one shared database. Azure Container Apps and Kubernetes can scale the API
  horizontally; run the in-process scheduler on exactly one replica
  (`ENABLE_SCHEDULER=false` on the rest). No change to the ~60 call sites, the
  recipes, or the container image — only a new package and a `DATABASE_URL`.
- **Verification:** the translator has unit tests, and the compat functions +
  shared migrations + representative queries (upsert-on-conflict, `INSERT OR
  IGNORE` idempotency, interval modifiers, camelCase-alias preservation) were
  executed against a real PostgreSQL engine (PGlite) and pass.
- **Trade-off:** PostgreSQL is another moving part to run and back up. It is
  strictly opt-in — leave `DATABASE_URL` empty and SQLite remains the default.
- **Scope:** the adapter targets the dialect this product actually uses. It is not
  a general-purpose D1→PostgreSQL shim; new SQL should stay within the same
  constructs (or extend `translateSql` with a test).
