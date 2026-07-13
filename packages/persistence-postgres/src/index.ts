/**
 * A D1-compatible storage adapter over PostgreSQL.
 *
 * It implements the exact slice of the D1 API the persistence layer uses —
 * `prepare().bind().first()/.all()/.run()` — so `@repo-wrangler/persistence-d1`
 * and the entire API run **unchanged** on PostgreSQL, exactly as they do on
 * Cloudflare D1 and the built-in SQLite adapter. This is the horizontal-scale
 * storage option the platform-neutrality plan (PN-1) calls for: unlike SQLite,
 * PostgreSQL is shared, so the Node host can run as multiple replicas behind a
 * load balancer (Azure Container Apps, Kubernetes) against one database.
 *
 * The SQL itself is rewritten by {@link translateSql}; the SQLite-specific
 * `datetime()` helpers are provided as real PostgreSQL functions by
 * {@link applyPostgresMigrations}, so the same `migrations/*.sql` files and the
 * same query strings serve both engines.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { translateSql } from './translate';

export { translateSql } from './translate';

const { Pool, types } = pg;

// PostgreSQL returns `COUNT(*)` and other bigint (int8, OID 20) values as
// strings to avoid precision loss. SQLite/D1 return them as numbers, and the
// callers do arithmetic and JSON-encode them as numbers, so parse int8 back to
// a JS number to preserve identical behaviour. Row counts here are always small.
types.setTypeParser(20, (value: string | null) => (value === null ? null : Number(value)));

type Pool = InstanceType<typeof Pool>;

class PostgresStatement {
  constructor(
    private readonly pool: Pool,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): PostgresStatement {
    // `undefined` is not a valid bound parameter; the persistence layer already
    // coalesces to `null` in most places, but normalise defensively.
    const params = values.map((v) => (v === undefined ? null : v));
    return new PostgresStatement(this.pool, this.sql, params);
  }

  async first<T = unknown>(): Promise<T | null> {
    const result = await this.pool.query(this.sql, this.params);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: true; meta: { changes: number } }> {
    const result = await this.pool.query(this.sql, this.params);
    return { results: result.rows as T[], success: true, meta: { changes: result.rowCount ?? 0 } };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = await this.pool.query(this.sql, this.params);
    return { success: true, meta: { changes: result.rowCount ?? 0 } };
  }
}

/** Structurally D1-compatible database. Cast to `D1Database` at the host seam. */
export class PostgresD1 {
  constructor(private readonly pool: Pool) {}
  prepare(sql: string): PostgresStatement {
    return new PostgresStatement(this.pool, translateSql(sql));
  }
}

export interface OpenedPostgres {
  d1: PostgresD1;
  pool: Pool;
}

/**
 * Open a PostgreSQL connection pool and return a D1-compatible handle. The
 * connection string is standard libpq (`postgres://user:pass@host:port/db`);
 * `?sslmode=require` and `PGSSLMODE`/`PG*` environment variables are honoured by
 * `pg` as usual, which covers Azure Database for PostgreSQL and most managed
 * providers.
 */
export function openPostgresD1(connectionString: string): OpenedPostgres {
  const pool = new Pool({ connectionString });
  return { d1: new PostgresD1(pool), pool };
}

/**
 * SQLite-compatibility functions so the shared, SQLite-dialect SQL runs on
 * PostgreSQL verbatim. `datetime('now')` and `datetime('now', <modifier>)`
 * become real functions returning the same `YYYY-MM-DD HH:MM:SS` UTC text
 * SQLite produces, and SQLite date modifiers (`'-7 days'`, `'+30 minutes'`, …)
 * are valid PostgreSQL `interval` inputs.
 */
const COMPAT_SQL = `
CREATE OR REPLACE FUNCTION datetime(ts text) RETURNS text AS $fn$
  SELECT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS');
$fn$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION datetime(ts text, modifier text) RETURNS text AS $fn$
  SELECT to_char((now() AT TIME ZONE 'UTC') + (modifier)::interval, 'YYYY-MM-DD HH24:MI:SS');
$fn$ LANGUAGE sql STABLE;
`;

/**
 * Install the compatibility functions, then apply every `migrations/*.sql` file
 * in order, once — the same idempotent, ledgered flow the SQLite adapter uses,
 * so a deployer never runs a migration step by hand. The identical `migrations/`
 * directory serves both engines because the DDL is plain SQL once `datetime()`
 * exists. Each file is applied inside a transaction so a failure leaves no
 * partial schema.
 */
export async function applyPostgresMigrations(pool: Pool, migrationsDir: string): Promise<string[]> {
  await pool.query(COMPAT_SQL);
  await pool.query(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const seen = await pool.query('SELECT name FROM _migrations WHERE name = $1', [file]);
    if (seen.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    applied.push(file);
  }
  return applied;
}
