/**
 * SQL dialect translation: SQLite/D1 → PostgreSQL.
 *
 * The persistence layer (`@repo-wrangler/persistence-d1`) is written once, in
 * SQLite/D1 dialect, and is called directly across ~60 sites in the API. Rather
 * than fork it per database, the Postgres adapter runs that **same SQL** after a
 * small, well-scoped rewrite. Everything else — `datetime('now')`,
 * `ON CONFLICT … DO UPDATE SET … = excluded.col`, integer-boolean columns — is
 * already valid PostgreSQL once the compatibility functions from
 * `migrations`/compat are installed (see `applyPostgresMigrations`).
 *
 * The rewrite handles exactly the three constructs that differ:
 *
 *  1. **Placeholders.** D1 uses `?1, ?2, …`; PostgreSQL uses `$1, $2, …`.
 *  2. **Case-preserving aliases.** PostgreSQL folds unquoted identifiers to
 *     lower case, so a column aliased `AS openCrs` comes back as `opencrs` and
 *     the caller's `row.openCrs` is `undefined`. Any alias that contains an
 *     upper-case letter is double-quoted to preserve the exact casing D1/SQLite
 *     returns. Lower-case aliases (and lower-case type names in a `CAST … AS
 *     type`) are left untouched because they already round-trip unchanged.
 *  3. **`INSERT OR IGNORE`.** SQLite's conflict-swallowing insert becomes
 *     `INSERT … ON CONFLICT DO NOTHING`, preserving the "0 rows affected on
 *     duplicate" semantics the webhook idempotency check relies on.
 *
 * The function is pure and deterministic so it can be unit-tested without a
 * live database (see `test/translate.test.ts`).
 */

/** Rewrite a single SQLite/D1 statement into its PostgreSQL equivalent. */
export function translateSql(sql: string): string {
  let out = sql;

  // 1. INSERT OR IGNORE INTO … → INSERT INTO … ON CONFLICT DO NOTHING.
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(out)) {
      out = `${out.replace(/;?\s*$/, '')} ON CONFLICT DO NOTHING`;
    }
  }

  // 2. Quote any alias that contains an upper-case letter so PostgreSQL keeps
  //    the exact casing the persistence layer reads back by property name.
  out = out.replace(/\bAS\s+([A-Za-z_]*[A-Z][A-Za-z0-9_]*)/g, 'AS "$1"');

  // 3. ?N positional placeholders → $N. The persistence layer uses numbered
  //    placeholders exclusively, so there is no bare `?` to disambiguate.
  out = out.replace(/\?(\d+)/g, '$$$1');

  return out;
}
