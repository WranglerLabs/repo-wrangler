import type { WorkspaceSnapshot } from '@repo-wrangler/domain';

export interface WorkspaceRow {
  id: string;
  connection_id: string;
  external_id: string;
  installation_id: string | null;
  slug: string;
  display_name: string | null;
  kind: string;
  avatar_url: string | null;
  status: string;
  last_reconciled_at: string | null;
}

export async function upsertWorkspace(
  db: D1Database,
  connectionId: string,
  snapshot: WorkspaceSnapshot,
): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM workspaces WHERE connection_id = ?1 AND external_id = ?2`)
    .bind(connectionId, snapshot.externalId)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE workspaces SET installation_id = ?2, slug = ?3, display_name = ?4, kind = ?5,
           avatar_url = ?6, status = 'active', last_seen_at = datetime('now')
         WHERE id = ?1`,
      )
      .bind(
        existing.id,
        snapshot.installationId ?? null,
        snapshot.slug,
        snapshot.displayName ?? null,
        snapshot.kind,
        snapshot.avatarUrl ?? null,
      )
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO workspaces (id, connection_id, external_id, installation_id, slug, display_name, kind, avatar_url)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
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
    )
    .run();
  return id;
}

export async function getWorkspaceByExternalId(
  db: D1Database,
  externalId: string,
): Promise<WorkspaceRow | null> {
  return db
    .prepare(`SELECT * FROM workspaces WHERE external_id = ?1 LIMIT 1`)
    .bind(externalId)
    .first<WorkspaceRow>();
}

export async function listWorkspaceRows(db: D1Database): Promise<WorkspaceRow[]> {
  const result = await db
    .prepare(`SELECT * FROM workspaces WHERE status = 'active' ORDER BY slug`)
    .all<WorkspaceRow>();
  return result.results;
}

export async function listWorkspacesForSync(db: D1Database): Promise<WorkspaceRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM workspaces
       WHERE status = 'active' AND monitoring_state = 'monitored' AND installation_id IS NOT NULL
       ORDER BY last_reconciled_at ASC NULLS FIRST`,
    )
    .all<WorkspaceRow>();
  return result.results;
}

export async function markWorkspaceReconciled(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE workspaces SET last_reconciled_at = datetime('now') WHERE id = ?1`)
    .bind(id)
    .run();
}
