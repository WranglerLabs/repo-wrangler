/** Small key/value store for platform counters and instance settings. */

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM meta WHERE key = ?1`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO meta (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .bind(key, value)
    .run();
}
