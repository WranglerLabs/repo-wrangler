export interface AuditEventRow {
  actor: string;
  action: string;
  detail: string | null;
  created_at: string;
}

export async function listAuditEvents(db: D1Database, limit = 50): Promise<AuditEventRow[]> {
  const result = await db
    .prepare(
      `SELECT actor, action, detail, created_at FROM audit_events
       ORDER BY created_at DESC LIMIT ?1`,
    )
    .bind(limit)
    .all<AuditEventRow>();
  return result.results;
}

export interface SyncJobEventRow {
  job_type: string;
  scope: string | null;
  state: string;
  finished_at: string | null;
  last_error: string | null;
}

export async function listRecentSyncJobEvents(
  db: D1Database,
  limit = 50,
): Promise<SyncJobEventRow[]> {
  const result = await db
    .prepare(
      `SELECT job_type, scope, state, finished_at, last_error FROM sync_jobs
       WHERE state IN ('done', 'failed') AND finished_at IS NOT NULL
       ORDER BY finished_at DESC LIMIT ?1`,
    )
    .bind(limit)
    .all<SyncJobEventRow>();
  return result.results;
}

export async function recordAuditEvent(
  db: D1Database,
  actor: string,
  action: string,
  detail?: string,
): Promise<void> {
  await db
    .prepare(`INSERT INTO audit_events (id, actor, action, detail) VALUES (?1, ?2, ?3, ?4)`)
    .bind(crypto.randomUUID(), actor, action, detail ?? null)
    .run();
}
