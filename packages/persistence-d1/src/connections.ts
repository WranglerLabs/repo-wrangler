export interface ConnectionRow {
  id: string;
  provider_type: string;
  display_name: string;
  status: string;
  last_success_at: string | null;
  last_error_code: string | null;
}

/**
 * Ensure the single *active* GitHub App connection row exists; return its id.
 * Filtering to `status = 'active'` matters once B5's "Disconnect" can
 * tombstone a row (`markConnectionRemoved`): reconnecting creates a fresh
 * connection rather than silently resurrecting the dead one under an id no
 * longer reachable through `getConnectionByType`.
 */
export async function ensureGitHubConnection(db: D1Database): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM provider_connections WHERE provider_type = 'github' AND status = 'active' LIMIT 1`)
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

/** Ensure the single *active* GitLab connection row exists; return its id (see `ensureGitHubConnection`). */
export async function ensureGitLabConnection(
  db: D1Database,
  baseUrl: string,
): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM provider_connections WHERE provider_type = 'gitlab' AND status = 'active' LIMIT 1`)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO provider_connections (id, provider_type, display_name, base_url, auth_type)
       VALUES (?1, 'gitlab', 'GitLab', ?2, 'token')`,
    )
    .bind(id, baseUrl)
    .run();
  return id;
}

export async function listConnections(db: D1Database): Promise<ConnectionRowFull[]> {
  const result = await db
    .prepare(
      `SELECT id, provider_type, display_name, status, last_success_at, last_error_code,
              base_url, auth_type, external_account_id, secret_reference, app_slug
       FROM provider_connections WHERE status != 'removed' ORDER BY created_at`,
    )
    .all<ConnectionRowFull>();
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

export interface ConnectionRowFull extends ConnectionRow {
  base_url: string | null;
  auth_type: string;
  external_account_id: string | null;
  secret_reference: string | null;
  /** GitHub App slug from the manifest conversion — only set on the exchange path (see 0005 migration). */
  app_slug: string | null;
}

export async function getConnectionById(
  db: D1Database,
  id: string,
): Promise<ConnectionRowFull | null> {
  return db
    .prepare(
      `SELECT id, provider_type, display_name, status, last_success_at, last_error_code,
              base_url, auth_type, external_account_id, secret_reference, app_slug
       FROM provider_connections WHERE id = ?1`,
    )
    .bind(id)
    .first<ConnectionRowFull>();
}

/**
 * Non-creating lookup, unlike `ensureGitHubConnection`/`ensureGitLabConnection`
 * — used by the on-demand credential resolver so checking "is anything
 * configured yet" never conjures a connection row into existence.
 */
export async function getConnectionByType(
  db: D1Database,
  providerType: 'github' | 'gitlab',
): Promise<ConnectionRowFull | null> {
  return db
    .prepare(
      `SELECT id, provider_type, display_name, status, last_success_at, last_error_code,
              base_url, auth_type, external_account_id, secret_reference, app_slug
       FROM provider_connections WHERE provider_type = ?1 AND status = 'active' LIMIT 1`,
    )
    .bind(providerType)
    .first<ConnectionRowFull>();
}

/**
 * Onboarding design B3 — the wizard's connect/exchange/credentials endpoints
 * reuse the same single-connection-per-provider row `ensureGitHubConnection`
 * / `ensureGitLabConnection` create (and the scheduler reads), then stamp its
 * `secret_reference` (a self-reference: the connection's own id is a
 * sufficient namespace) so the writable secret backend has somewhere to
 * point. Idempotent — safe to call again on credential rotation.
 */
export async function setConnectionSecretReference(
  db: D1Database,
  id: string,
  reference: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections SET secret_reference = ?2, updated_at = datetime('now') WHERE id = ?1`,
    )
    .bind(id, reference)
    .run();
}

/** Persist the manifest conversion's app slug so a later page load can rebuild the install URL. */
export async function setConnectionAppSlug(
  db: D1Database,
  id: string,
  appSlug: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections SET app_slug = ?2, updated_at = datetime('now') WHERE id = ?1`,
    )
    .bind(id, appSlug)
    .run();
}

export async function updateConnectionDisplayName(
  db: D1Database,
  id: string,
  displayName: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections SET display_name = ?2, updated_at = datetime('now') WHERE id = ?1`,
    )
    .bind(id, displayName)
    .run();
}

/** Tombstone, never delete (B5 "Disconnect") — the connection stops being used. */
export async function markConnectionRemoved(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_connections SET status = 'removed', updated_at = datetime('now') WHERE id = ?1`,
    )
    .bind(id)
    .run();
}
