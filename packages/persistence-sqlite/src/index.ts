/**
 * A D1-compatible storage adapter over SQLite (Node 22's built-in `node:sqlite`,
 * no native dependency). It implements the small slice of the D1 API that the
 * persistence layer actually uses — `prepare().bind().first()/.all()/.run()` —
 * so `@repo-wrangler/persistence-d1` and the entire API run **unchanged** with no
 * Cloudflare. This is the seam the design's Portability section calls for: swap
 * the storage adapter, keep the domain, providers, API, and UI.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type BindValue = string | number | bigint | null | Uint8Array;

class SqliteStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: BindValue[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.db, this.sql, values as BindValue[]);
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row as T | undefined) ?? null;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: true; meta: { changes: number } }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows, success: true, meta: { changes: rows.length } };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

/** Structurally D1-compatible database. Cast to `D1Database` at the host seam. */
export class SqliteD1 {
  constructor(private readonly db: DatabaseSync) {}
  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.db, sql);
  }
}

export interface OpenedSqlite {
  d1: SqliteD1;
  raw: DatabaseSync;
}

/** Open (or create) a SQLite database file and return a D1-compatible handle. */
export function openSqliteD1(location: string): OpenedSqlite {
  const db = new DatabaseSync(location);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return { d1: new SqliteD1(db), raw: db };
}

/**
 * Apply every migrations/*.sql file in order, once. Idempotent: a _migrations
 * ledger records what has run, so re-applying is a no-op — the same guarantee
 * `wrangler d1 migrations apply` gives, without Cloudflare.
 */
export function applyMigrations(db: DatabaseSync, migrationsDir: string): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));",
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    const seen = db.prepare('SELECT name FROM _migrations WHERE name = ?').get(file);
    if (seen) continue;
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    applied.push(file);
  }
  return applied;
}
