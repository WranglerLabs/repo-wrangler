export interface ConnectionRow {
  id: string;
  provider_type: string;
  display_name: string;
  status: string;
  last_success_at: string | null;
  last_error_code: string | null;
}

/** Ensure the one process-environment GitHub connection exists. */
export async function ensureGitHubConnection(db: D1Database): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT id FROM provider_connections
       WHERE provider_type = 'github' AND status != 'removed'
         AND credential_source = 'environment'
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC`,
    )
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO provider_connections (
         id, provider_type, display_name, auth_type, credential_source
       ) VALUES (?1, 'github', 'GitHub App', 'github_app', 'environment')`,
    )
    .bind(id)
    .run();
  return id;
}

/** Ensure the one process-environment GitLab connection exists. */
export async function ensureGitLabConnection(
  db: D1Database,
  baseUrl: string,
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT id FROM provider_connections
       WHERE provider_type = 'gitlab' AND status != 'removed'
         AND credential_source = 'environment' AND COALESCE(base_url, '') = ?1
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC`,
    )
    .bind(baseUrl)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO provider_connections (
         id, provider_type, display_name, base_url, auth_type, credential_source
       ) VALUES (?1, 'gitlab', 'GitLab', ?2, 'token', 'environment')`,
    )
    .bind(id, baseUrl)
    .run();
  return id;
}

export async function listConnections(db: D1Database): Promise<ConnectionRowFull[]> {
  const result = await db
    .prepare(
      `SELECT id, provider_type, display_name, status, last_success_at, last_error_code,
              base_url, auth_type, external_account_id, secret_reference, app_slug,
              credential_source, capability_status, permission_details,
              last_discovery_at, last_billing_at
       FROM provider_connections WHERE status != 'removed' ORDER BY created_at`,
    )
    .all<ConnectionRowFull>();
  return result.results;
}

export async function createProviderConnection(
  db: D1Database,
  input: {
    providerType: 'github' | 'gitlab';
    displayName: string;
    authType: 'github_app' | 'token';
    baseUrl?: string;
    externalAccountId?: string;
    credentialSource?: 'database' | 'environment';
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO provider_connections (
       id, provider_type, display_name, base_url, auth_type, external_account_id, credential_source
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(id, input.providerType, input.displayName, input.baseUrl ?? null, input.authType,
    input.externalAccountId ?? null, input.credentialSource ?? 'database').run();
  return id;
}

export async function listActiveConnectionsByType(
  db: D1Database,
  providerType: 'github' | 'gitlab',
): Promise<ConnectionRowFull[]> {
  const result = await db.prepare(
    `SELECT id, provider_type, display_name, status, last_success_at, last_error_code,
            base_url, auth_type, external_account_id, secret_reference, app_slug,
            credential_source, capability_status, permission_details,
            last_discovery_at, last_billing_at
     FROM provider_connections
     WHERE provider_type = ?1 AND status = 'active'
     ORDER BY created_at, id`,
  ).bind(providerType).all<ConnectionRowFull>();
  return result.results;
}

export async function getEnvironmentConnectionByType(
  db: D1Database,
  providerType: 'github' | 'gitlab',
  baseUrl?: string,
): Promise<ConnectionRowFull | null> {
  const result = await db.prepare(
    `SELECT id, provider_type, display_name, status, last_success_at, last_error_code,
            base_url, auth_type, external_account_id, secret_reference, app_slug,
            credential_source, capability_status, permission_details,
            last_discovery_at, last_billing_at
     FROM provider_connections
     WHERE provider_type = ?1 AND credential_source = 'environment'
       AND (?2 IS NULL OR COALESCE(base_url, '') = ?2)
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'disabled' THEN 1 ELSE 2 END,
              created_at DESC, id`,
  ).bind(providerType, baseUrl ?? null).all<ConnectionRowFull>();
  return result.results[0] ?? null;
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

export async function recordConnectionCapability(
  db: D1Database,
  id: string,
  status: string,
  permissions?: Record<string, string>,
): Promise<void> {
  await db.prepare(
    `UPDATE provider_connections SET capability_status = ?2, permission_details = ?3,
       updated_at = datetime('now') WHERE id = ?1`,
  ).bind(id, status, permissions ? JSON.stringify(permissions) : null).run();
}

export interface ConnectionRowFull extends ConnectionRow {
  base_url: string | null;
  auth_type: string;
  external_account_id: string | null;
  secret_reference: string | null;
  /** GitHub App slug from the manifest conversion — only set on the exchange path (see 0005 migration). */
  app_slug: string | null;
  credential_source?: string | null;
  capability_status?: string | null;
  permission_details?: string | null;
  last_discovery_at?: string | null;
  last_billing_at?: string | null;
}

export interface ConnectionSummaryRow extends ConnectionRowFull {
  workspace_count: number;
  repository_count: number;
  pending_work: number;
}

export async function listConnectionSummaries(db: D1Database): Promise<ConnectionSummaryRow[]> {
  const result = await db.prepare(
    `SELECT c.id, c.provider_type, c.display_name, c.status, c.last_success_at,
            c.last_error_code, c.base_url, c.auth_type, c.external_account_id,
            c.secret_reference, c.app_slug, c.credential_source, c.capability_status,
            c.permission_details, c.last_discovery_at, c.last_billing_at,
            (SELECT COUNT(*) FROM workspaces w WHERE w.connection_id = c.id AND w.status = 'active') AS workspace_count,
            (SELECT COUNT(*) FROM repositories r JOIN workspaces w ON w.id = r.workspace_id
              WHERE w.connection_id = c.id AND w.status = 'active'
                AND w.monitoring_state = 'monitored' AND r.status = 'active'
                AND r.monitoring_state = 'monitored') AS repository_count,
            (SELECT COUNT(*) FROM sync_jobs j
              WHERE j.state IN ('pending', 'running') AND (
                j.scope = c.id OR EXISTS (
                  SELECT 1 FROM repositories queued_repository
                  JOIN workspaces queued_workspace ON queued_workspace.id = queued_repository.workspace_id
                  WHERE queued_repository.id = j.scope AND queued_workspace.connection_id = c.id
                )
              )) AS pending_work
     FROM provider_connections c ORDER BY c.created_at`,
  ).all<ConnectionSummaryRow>();
  return result.results;
}

export async function setConnectionStatus(
  db: D1Database,
  id: string,
  status: 'active' | 'disabled',
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE provider_connections SET status = ?2,
       disabled_at = CASE WHEN ?2 = 'disabled' THEN datetime('now') ELSE NULL END,
       updated_at = datetime('now') WHERE id = ?1 AND status != 'removed'`,
  ).bind(id, status).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function recordConnectionOperation(
  db: D1Database,
  id: string,
  operation: 'discovery' | 'billing',
): Promise<void> {
  const column = operation === 'discovery' ? 'last_discovery_at' : 'last_billing_at';
  await db.prepare(
    `UPDATE provider_connections SET ${column} = datetime('now'), updated_at = datetime('now') WHERE id = ?1`,
  ).bind(id).run();
}

export async function getConnectionById(
  db: D1Database,
  id: string,
): Promise<ConnectionRowFull | null> {
  return db
    .prepare(
      `SELECT id, provider_type, display_name, status, last_success_at, last_error_code,
              base_url, auth_type, external_account_id, secret_reference, app_slug,
              credential_source, capability_status, permission_details,
              last_discovery_at, last_billing_at
       FROM provider_connections WHERE id = ?1`,
    )
    .bind(id)
    .first<ConnectionRowFull>();
}

/**
 * Compatibility lookup for callers that require an unambiguous provider
 * connection. Multiple active connections deliberately produce null rather
 * than silently selecting whichever row happens to sort first.
 */
export async function getConnectionByType(
  db: D1Database,
  providerType: 'github' | 'gitlab',
): Promise<ConnectionRowFull | null> {
  const result = await db
    .prepare(
      `SELECT id, provider_type, display_name, status, last_success_at, last_error_code,
              base_url, auth_type, external_account_id, secret_reference, app_slug,
              credential_source, capability_status, permission_details,
              last_discovery_at, last_billing_at
       FROM provider_connections WHERE provider_type = ?1 AND status = 'active'
       ORDER BY created_at, id`,
    )
    .bind(providerType)
    .all<ConnectionRowFull>();
  return result.results.length === 1 ? result.results[0] ?? null : null;
}

/**
 * Stamp a connection's own credential namespace after creation or rotation.
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

/** Record the stable provider-side identity represented by a connection. */
export async function updateConnectionExternalAccountId(
  db: D1Database,
  id: string,
  externalAccountId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE provider_connections SET external_account_id = ?2,
       updated_at = datetime('now') WHERE id = ?1`,
  ).bind(id, externalAccountId).run();
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
