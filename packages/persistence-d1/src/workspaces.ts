import type { MonitoringState, WorkspaceSnapshot } from '@repo-wrangler/domain';

export interface WorkspaceRow {
  id: string;
  connection_id: string;
  external_id: string;
  installation_id: string | null;
  slug: string;
  display_name: string | null;
  kind: string;
  avatar_url: string | null;
  monitoring_state: MonitoringState;
  status: string;
  last_reconciled_at: string | null;
  status_reason: string | null;
  state_changed_at: string | null;
  removed_at: string | null;
}

export async function upsertWorkspace(
  db: D1Database,
  connectionId: string,
  snapshot: WorkspaceSnapshot,
  lifecycle: {
    status: 'active' | 'inaccessible' | 'removed';
    reason: string | null;
  } = { status: 'active', reason: null },
): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM workspaces WHERE connection_id = ?1 AND external_id = ?2`)
    .bind(connectionId, snapshot.externalId)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE workspaces SET installation_id = ?2, slug = ?3, display_name = ?4, kind = ?5,
           avatar_url = ?6, status = ?7, status_reason = ?8,
           removed_at = CASE WHEN ?7 = 'removed' THEN COALESCE(removed_at, datetime('now')) ELSE NULL END,
           state_changed_at = CASE
             WHEN status != ?7 OR COALESCE(status_reason, '') != COALESCE(?8, '')
             THEN datetime('now') ELSE state_changed_at END,
           last_seen_at = datetime('now')
         WHERE id = ?1`,
      )
      .bind(
        existing.id,
        snapshot.installationId ?? null,
        snapshot.slug,
        snapshot.displayName ?? null,
        snapshot.kind,
        snapshot.avatarUrl ?? null,
        lifecycle.status,
        lifecycle.reason,
      )
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO workspaces (
         id, connection_id, external_id, installation_id, slug, display_name, kind, avatar_url,
         status, status_reason, state_changed_at, removed_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'),
         CASE WHEN ?9 = 'removed' THEN datetime('now') ELSE NULL END)`,
    )
    .bind(
      id,
      connectionId,
      snapshot.externalId,
      snapshot.installationId ?? null,
      snapshot.slug,
      snapshot.displayName ?? null,
      snapshot.kind,
      snapshot.avatarUrl ?? null,
      lifecycle.status,
      lifecycle.reason,
    )
    .run();
  return id;
}

export async function getWorkspaceByExternalId(
  db: D1Database,
  externalId: string,
): Promise<WorkspaceRow | null> {
  const result = await db
    .prepare(`SELECT * FROM workspaces WHERE external_id = ?1 ORDER BY id LIMIT 2`)
    .bind(externalId)
    .all<WorkspaceRow>();
  return result.results.length === 1 ? result.results[0]! : null;
}

export async function listWorkspaceRows(db: D1Database): Promise<WorkspaceRow[]> {
  const result = await db
    .prepare(`SELECT * FROM workspaces WHERE status = 'active' ORDER BY slug`)
    .all<WorkspaceRow>();
  return result.results;
}

export interface WorkspaceRowWithProvider extends WorkspaceRow {
  provider_type: string;
}

/** `listWorkspaceRows` plus each workspace's real provider (B5 estate scope). */
export async function listWorkspaceRowsWithProvider(
  db: D1Database,
): Promise<WorkspaceRowWithProvider[]> {
  const result = await db
    .prepare(
      `SELECT w.*, c.provider_type AS provider_type
       FROM workspaces w JOIN provider_connections c ON c.id = w.connection_id
       WHERE w.status = 'active' AND c.status = 'active' ORDER BY w.slug`,
    )
    .all<WorkspaceRowWithProvider>();
  return result.results;
}

/**
 * All active workspaces belonging to one connection, regardless of monitoring
 * state (B4 — GitLab discovery prefers these persisted rows over
 * `GITLAB_GROUPS` when the operator selected groups through the wizard).
 */
export async function listWorkspacesForConnection(
  db: D1Database,
  connectionId: string,
): Promise<WorkspaceRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM workspaces WHERE connection_id = ?1 AND status = 'active' ORDER BY slug`,
    )
    .bind(connectionId)
    .all<WorkspaceRow>();
  return result.results;
}

export async function listWorkspacesForSync(db: D1Database): Promise<WorkspaceRow[]> {
  const result = await db
    .prepare(
      `SELECT w.* FROM workspaces w
       JOIN provider_connections c ON c.id = w.connection_id
       WHERE w.status = 'active' AND w.monitoring_state = 'monitored'
         AND w.installation_id IS NOT NULL AND c.status = 'active'
       ORDER BY w.last_reconciled_at ASC NULLS FIRST`,
    )
    .all<WorkspaceRow>();
  return result.results;
}

/** B1 — `GET /onboarding/status`'s `monitoredWorkspaces` count. */
export async function countMonitoredWorkspaces(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM workspaces w
       JOIN provider_connections c ON c.id = w.connection_id
       WHERE w.status = 'active' AND w.monitoring_state = 'monitored' AND c.status = 'active'`,
    )
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function markWorkspaceReconciled(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE workspaces SET last_reconciled_at = datetime('now') WHERE id = ?1`)
    .bind(id)
    .run();
}

export async function listAllWorkspacesForConnection(
  db: D1Database,
  connectionId: string,
): Promise<WorkspaceRow[]> {
  const result = await db.prepare(
    `SELECT * FROM workspaces WHERE connection_id = ?1
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'inaccessible' THEN 1 ELSE 2 END, slug`,
  ).bind(connectionId).all<WorkspaceRow>();
  return result.results;
}

/** Provider scopes still eligible for discovery, including retryable failures. */
export async function listWorkspacesConfiguredForDiscovery(
  db: D1Database,
  connectionId: string,
): Promise<WorkspaceRow[]> {
  const result = await db.prepare(
    `SELECT * FROM workspaces
     WHERE connection_id = ?1
       AND NOT (status = 'removed' AND status_reason = 'detached_by_operator')
     ORDER BY slug`,
  ).bind(connectionId).all<WorkspaceRow>();
  return result.results;
}

export async function detachWorkspaceFromConnection(
  db: D1Database,
  connectionId: string,
  workspaceId: string,
): Promise<boolean> {
  const workspace = await db.prepare(
    'SELECT id FROM workspaces WHERE id = ?2 AND connection_id = ?1',
  ).bind(connectionId, workspaceId).first<{ id: string }>();
  if (!workspace) return false;
  await markWorkspaceState(db, workspaceId, 'removed', 'detached_by_operator');
  return true;
}

export async function listWorkspacesForBilling(db: D1Database): Promise<WorkspaceRow[]> {
  const result = await db.prepare(
    `SELECT w.* FROM workspaces w
     JOIN provider_connections c ON c.id = w.connection_id
     WHERE w.status = 'active' AND w.monitoring_state = 'monitored'
       AND w.installation_id IS NOT NULL AND c.status = 'active'
     ORDER BY w.connection_id, w.id`,
  ).all<WorkspaceRow>();
  return result.results;
}

export async function getWorkspaceByConnectionAndExternalId(
  db: D1Database,
  connectionId: string,
  externalId: string,
): Promise<WorkspaceRow | null> {
  return db.prepare(
    'SELECT * FROM workspaces WHERE connection_id = ?1 AND external_id = ?2 LIMIT 1',
  ).bind(connectionId, externalId).first<WorkspaceRow>();
}

export async function markWorkspaceState(
  db: D1Database,
  id: string,
  status: 'active' | 'inaccessible' | 'removed',
  reason: string,
): Promise<void> {
  await db.prepare(
    `UPDATE workspaces SET status = ?2, status_reason = ?3,
       state_changed_at = CASE WHEN status != ?2
         OR COALESCE(status_reason, '') != COALESCE(?3, '')
         THEN datetime('now') ELSE state_changed_at END,
       removed_at = CASE WHEN ?2 = 'removed' THEN COALESCE(removed_at, datetime('now')) ELSE NULL END,
       last_reconciled_at = datetime('now') WHERE id = ?1`,
  ).bind(id, status, reason).run();
  if (status !== 'active') {
    await db.prepare(
      `UPDATE repositories SET status = ?2, status_reason = ?3,
         state_changed_at = CASE WHEN status != ?2
           OR COALESCE(status_reason, '') != COALESCE(?3, '')
           THEN datetime('now') ELSE state_changed_at END,
         removed_at = CASE WHEN ?2 = 'removed' THEN COALESCE(removed_at, datetime('now')) ELSE removed_at END,
         last_reconciled_at = datetime('now')
       WHERE workspace_id = ?1 AND status = 'active'`,
    ).bind(id, status, reason).run();
  }
}

/** Call only after a complete connection-wide discovery pass. */
export async function markUnseenWorkspacesInactive(
  db: D1Database,
  connectionId: string,
  seenExternalIds: string[],
  reason = 'unknown_pending_confirmation',
  status: 'inaccessible' | 'removed' = 'inaccessible',
): Promise<number> {
  const exclusion = seenExternalIds.length === 0
    ? ''
    : `AND external_id NOT IN (${seenExternalIds.map((_, index) => `?${index + 4}`).join(', ')})`;
  const result = await db.prepare(
    `UPDATE workspaces SET status = ?3, status_reason = ?2,
       state_changed_at = CASE WHEN status != ?3
         OR COALESCE(status_reason, '') != COALESCE(?2, '')
         THEN datetime('now') ELSE state_changed_at END,
       removed_at = CASE WHEN ?3 = 'removed' THEN COALESCE(removed_at, datetime('now')) ELSE removed_at END,
       last_reconciled_at = datetime('now')
     WHERE connection_id = ?1 AND status = 'active' ${exclusion}`,
  ).bind(connectionId, reason, status, ...seenExternalIds).run();
  await db.prepare(
    `UPDATE repositories SET status = ?3, status_reason = ?2,
       state_changed_at = CASE WHEN status != ?3
         OR COALESCE(status_reason, '') != COALESCE(?2, '')
         THEN datetime('now') ELSE state_changed_at END,
       removed_at = CASE WHEN ?3 = 'removed' THEN COALESCE(removed_at, datetime('now')) ELSE removed_at END,
       last_reconciled_at = datetime('now')
     WHERE status = 'active' AND workspace_id IN (
       SELECT id FROM workspaces
       WHERE connection_id = ?1 AND status = ?3 AND status_reason = ?2
     )`,
  ).bind(connectionId, reason, status).run();
  return result.meta.changes ?? 0;
}

/**
 * Operator decision, not a discovery event: `updated_at`/`last_seen_at` are
 * left untouched. Returns false if no such workspace exists (A1).
 */
export async function setWorkspaceMonitoringState(
  db: D1Database,
  id: string,
  state: MonitoringState,
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE workspaces SET monitoring_state = ?2 WHERE id = ?1`)
    .bind(id, state)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Current monitoring state, for the discovery loop's org-level skip (A2). */
export async function getWorkspaceMonitoringState(
  db: D1Database,
  id: string,
): Promise<MonitoringState | null> {
  const row = await db
    .prepare(`SELECT monitoring_state FROM workspaces WHERE id = ?1`)
    .bind(id)
    .first<{ monitoring_state: MonitoringState }>();
  return row?.monitoring_state ?? null;
}
