export interface ConnectionRow {
  id: string;
  provider_type: string;
  display_name: string;
  status: string;
  last_success_at: string | null;
  last_error_code: string | null;
}

/** Ensure the single GitHub App connection row exists; return its id. */
export async function ensureGitHubConnection(db: D1Database): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM provider_connections WHERE provider_type = 'github' LIMIT 1`)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO provider_connections (id, provider_type, display_name, auth_type)
       VALUES (?1, 'github', 'GitHub App', 'github_app')`,
    )
    .bind(id)
    .run();
  return id;
}

export async function listConnections(db: D1Database): Promise<ConnectionRow[]> {
  const result = await db
    .prepare(
      `SELECT id, provider_type, display_name, status, last_success_at, last_error_code
       FROM provider_connections ORDER BY created_at`,
    )
    .all<ConnectionRow>();
  return result.results;
}

export async function recordConnectionSuccess(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections
       SET last_success_at = datetime('now'), last_error_code = NULL, updated_at = datetime('now')
       WHERE id = ?1`,
    )
    .bind(id)
    .run();
}

export async function recordConnectionError(
  db: D1Database,
  id: string,
  code: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections
       SET last_error_code = ?2, updated_at = datetime('now') WHERE id = ?1`,
    )
    .bind(id, code)
    .run();
}
