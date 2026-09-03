export type OperationStatus = 'pending' | 'running' | 'completed' | 'failed';

export async function beginOperationRun(
  db: D1Database,
  input: { id: string; jobId: string; type: string; connectionId?: string; workspaceId?: string },
): Promise<void> {
  await db.prepare(
    `INSERT INTO operation_runs (
       id, job_id, operation_type, connection_id, workspace_id, status,
       correlation_id, started_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?1, datetime('now'))
     ON CONFLICT (id) DO UPDATE SET status = 'running',
       started_at = COALESCE(operation_runs.started_at, datetime('now')),
       completed_at = NULL, result_summary = NULL, error_code = NULL,
       error_detail = NULL, retry_eligible = 0`,
  ).bind(input.id, input.jobId, input.type, input.connectionId ?? null,
    input.workspaceId ?? null).run();
}

export async function checkpointOperationRun(
  db: D1Database,
  id: string,
  checkpoint: string,
  subrequestsUsed: number,
): Promise<void> {
  await db.prepare(
    `UPDATE operation_runs SET status = 'pending', checkpoint = ?2,
       subrequests_used = subrequests_used + ?3 WHERE id = ?1`,
  ).bind(id, checkpoint, subrequestsUsed).run();
}

export async function completeOperationRun(
  db: D1Database,
  id: string,
  subrequestsUsed: number,
  summary: Record<string, unknown> = {},
): Promise<void> {
  await db.prepare(
    `UPDATE operation_runs SET status = 'completed', completed_at = datetime('now'),
       subrequests_used = subrequests_used + ?2, result_summary = ?3,
       error_code = NULL, error_detail = NULL, retry_eligible = 0 WHERE id = ?1`,
  ).bind(id, subrequestsUsed, JSON.stringify(summary)).run();
}

export async function failOperationRun(
  db: D1Database,
  id: string,
  code: string,
  detail: string,
): Promise<void> {
  await db.prepare(
    `UPDATE operation_runs SET status = 'failed', completed_at = datetime('now'),
       error_code = ?2, error_detail = ?3, retry_eligible = 1 WHERE id = ?1`,
  ).bind(id, code, detail.slice(0, 500)).run();
}

export async function failTrackedRuns(
  db: D1Database,
  id: string,
  code: string,
  detail: string,
): Promise<void> {
  await failOperationRun(db, id, code, detail);
  await db.prepare(
    `UPDATE discovery_runs SET status = 'failed', completed_at = datetime('now'),
       error_code = ?2, error_detail = ?3, retry_eligible = 1 WHERE id = ?1`,
  ).bind(id, code, detail.slice(0, 500)).run();
}

export async function beginDiscoveryRun(
  db: D1Database,
  jobId: string,
  connectionId: string,
): Promise<void> {
  await beginOperationRun(db, { id: jobId, jobId, type: 'discovery', connectionId });
  await db.prepare(
    `INSERT INTO discovery_runs (
       id, job_id, connection_id, status, correlation_id, started_at
     ) VALUES (?1, ?1, ?2, 'running', ?1, datetime('now'))
     ON CONFLICT (id) DO UPDATE SET status = 'running',
       started_at = COALESCE(discovery_runs.started_at, datetime('now')), completed_at = NULL,
       summary = '{}', error_code = NULL, error_detail = NULL, retry_eligible = 0`,
  ).bind(jobId, connectionId).run();
}

export async function recordDiscoveryWorkspaceSeen(
  db: D1Database,
  runId: string,
  connectionId: string,
  externalId: string,
  workspaceId?: string,
): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO discovery_run_seen_workspaces
       (run_id, connection_id, workspace_external_id, workspace_id) VALUES (?1, ?2, ?3, ?4)`,
  ).bind(runId, connectionId, externalId, workspaceId ?? null).run();
  if (workspaceId) {
    await db.prepare(
      `UPDATE discovery_run_seen_workspaces SET workspace_id = ?4
       WHERE run_id = ?1 AND connection_id = ?2 AND workspace_external_id = ?3`,
    ).bind(runId, connectionId, externalId, workspaceId).run();
  }
}

export async function markDiscoveryWorkspaceScanComplete(
  db: D1Database,
  runId: string,
  workspaceId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE discovery_run_seen_workspaces SET repository_scan_completed = 1
     WHERE run_id = ?1 AND workspace_id = ?2`,
  ).bind(runId, workspaceId).run();
}

export async function prepareDiscoveryRunForReconciliation(
  db: D1Database,
  runId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE discovery_runs SET status = 'reconciling'
     WHERE id = ?1 AND status = 'running'`,
  ).bind(runId).run();
}

/** Apply missing transitions only after the complete applicable pass succeeds. */
export async function reconcileDiscoveryRunMissingRepositories(
  db: D1Database,
  runId: string,
): Promise<number> {
  const result = await db.prepare(
    `UPDATE repositories SET status = 'inaccessible',
       status_reason = 'not_seen_after_complete_discovery', state_changed_at = datetime('now'),
       last_reconciled_at = datetime('now')
     WHERE status = 'active'
       AND EXISTS (SELECT 1 FROM discovery_runs run WHERE run.id = ?1 AND run.status = 'reconciling')
       AND workspace_id IN (
         SELECT workspace_id FROM discovery_run_seen_workspaces
         WHERE run_id = ?1 AND repository_scan_completed = 1 AND workspace_id IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM discovery_run_seen_repositories seen
         WHERE seen.run_id = ?1 AND seen.workspace_id = repositories.workspace_id
           AND seen.repository_external_id = repositories.external_id
       )`,
  ).bind(runId).run();
  return result.meta.changes ?? 0;
}

export async function recordDiscoveryRepositorySeen(
  db: D1Database,
  runId: string,
  workspaceId: string,
  externalId: string,
): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO discovery_run_seen_repositories
       (run_id, workspace_id, repository_external_id) VALUES (?1, ?2, ?3)`,
  ).bind(runId, workspaceId, externalId).run();
}

export async function checkpointDiscoveryRun(
  db: D1Database,
  id: string,
  checkpoint: string,
  subrequestsUsed: number,
): Promise<void> {
  await checkpointOperationRun(db, id, checkpoint, subrequestsUsed);
  await db.prepare(
    `UPDATE discovery_runs SET status = 'pending', checkpoint = ?2,
       subrequests_used = subrequests_used + ?3 WHERE id = ?1`,
  ).bind(id, checkpoint, subrequestsUsed).run();
}

export async function completeDiscoveryRun(
  db: D1Database,
  id: string,
  subrequestsUsed: number,
  summary: Record<string, unknown>,
): Promise<void> {
  await completeOperationRun(db, id, subrequestsUsed, summary);
  await db.prepare(
    `UPDATE discovery_runs SET status = 'completed', completed_at = datetime('now'),
       subrequests_used = subrequests_used + ?2, summary = ?3,
       error_code = NULL, error_detail = NULL, retry_eligible = 0 WHERE id = ?1`,
  ).bind(id, subrequestsUsed, JSON.stringify(summary)).run();
}

/** Finish a complete pass that safely reconciled some scopes but failed others. */
export async function failPartialDiscoveryRun(
  db: D1Database,
  id: string,
  subrequestsUsed: number,
  summary: Record<string, unknown>,
  detail: string,
): Promise<void> {
  const safeDetail = detail.slice(0, 500);
  await db.prepare(
    `UPDATE operation_runs SET status = 'failed', completed_at = datetime('now'),
       subrequests_used = subrequests_used + ?2, result_summary = ?3,
       error_code = 'partial_discovery_failure', error_detail = ?4,
       retry_eligible = 1 WHERE id = ?1`,
  ).bind(id, subrequestsUsed, JSON.stringify(summary), safeDetail).run();
  await db.prepare(
    `UPDATE discovery_runs SET status = 'failed', completed_at = datetime('now'),
       subrequests_used = subrequests_used + ?2, summary = ?3,
       error_code = 'partial_discovery_failure', error_detail = ?4,
       retry_eligible = 1 WHERE id = ?1`,
  ).bind(id, subrequestsUsed, JSON.stringify(summary), safeDetail).run();
}

export async function beginUsageImport(
  db: D1Database,
  input: {
    id: string;
    jobId: string;
    connectionId: string;
    workspaceId: string;
    periodStart: string;
    periodEnd: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO usage_imports (
       id, job_id, connection_id, workspace_id, period_start, period_end,
       status, correlation_id, started_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?2, datetime('now'))
     ON CONFLICT (id) DO UPDATE SET status = 'running',
       started_at = COALESCE(usage_imports.started_at, datetime('now')), completed_at = NULL`,
  ).bind(input.id, input.jobId, input.connectionId, input.workspaceId,
    input.periodStart, input.periodEnd).run();
}

export async function completeUsageImport(
  db: D1Database,
  id: string,
  status: 'completed' | 'failed',
  rowsImported: number,
  subrequestsUsed: number,
  errorCode?: string,
  errorDetail?: string,
): Promise<void> {
  await db.prepare(
    `UPDATE usage_imports SET status = ?2, completed_at = datetime('now'),
       rows_imported = ?3, subrequests_used = ?4, error_code = ?5, error_detail = ?6,
       retry_eligible = CASE WHEN ?2 = 'failed' THEN 1 ELSE 0 END WHERE id = ?1`,
  ).bind(id, status, rowsImported, subrequestsUsed, errorCode ?? null,
    errorDetail?.slice(0, 500) ?? null).run();
}

export interface UsageImportRow {
  id: string;
  job_id: string | null;
  connection_id: string;
  workspace_id: string | null;
  status: string;
  correlation_id: string;
  started_at: string | null;
  completed_at: string | null;
  subrequests_used: number;
  checkpoint: string | null;
  rows_imported: number;
  error_code: string | null;
  error_detail: string | null;
  retry_eligible: number;
  created_at: string;
}

export async function listUsageImports(db: D1Database, limit = 200): Promise<UsageImportRow[]> {
  const result = await db.prepare(
    'SELECT * FROM usage_imports ORDER BY created_at DESC LIMIT ?1',
  ).bind(limit).all<UsageImportRow>();
  return result.results;
}

export async function getUsageImport(db: D1Database, id: string): Promise<UsageImportRow | null> {
  return db.prepare('SELECT * FROM usage_imports WHERE id = ?1')
    .bind(id).first<UsageImportRow>();
}

export async function hasSuccessfulUsageImport(
  db: D1Database,
  workspaceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT id FROM usage_imports
     WHERE workspace_id = ?1 AND period_start = ?2 AND period_end = ?3
       AND status = 'completed'`,
  ).bind(workspaceId, periodStart, periodEnd).first<{ id: string }>();
  return Boolean(row);
}
