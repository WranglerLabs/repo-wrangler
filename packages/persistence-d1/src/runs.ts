import type { PipelineRunSnapshot } from '@repo-wrangler/domain';

export interface PipelineRunRow {
  id: string;
  repository_id: string;
  external_id: string;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  branch: string | null;
  url: string | null;
  run_started_at: string | null;
  duration_seconds: number | null;
  observed_at: string;
}

export async function upsertPipelineRun(
  db: D1Database,
  repositoryId: string,
  run: PipelineRunSnapshot,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pipeline_runs (
         id, repository_id, external_id, name, status, conclusion, branch, head_sha,
         event, actor, url, run_started_at, completed_at, duration_seconds, attempt, failure_summary
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT (repository_id, external_id) DO UPDATE SET
         name = excluded.name,
         status = excluded.status,
         conclusion = excluded.conclusion,
         branch = excluded.branch,
         head_sha = excluded.head_sha,
         url = excluded.url,
         run_started_at = excluded.run_started_at,
         completed_at = excluded.completed_at,
         duration_seconds = excluded.duration_seconds,
         attempt = excluded.attempt,
         failure_summary = excluded.failure_summary,
         observed_at = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(),
      repositoryId,
      run.externalId,
      run.name ?? null,
      run.status,
      run.conclusion ?? null,
      run.branch ?? null,
      run.headSha ?? null,
      run.event ?? null,
      run.actor ?? null,
      run.url ?? null,
      run.runStartedAt ?? null,
      run.completedAt ?? null,
      run.durationSeconds ?? null,
      run.attempt ?? null,
      run.failureSummary ?? null,
    )
    .run();
}

export async function listRecentRuns(
  db: D1Database,
  repositoryId: string,
  limit = 10,
): Promise<PipelineRunRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM pipeline_runs WHERE repository_id = ?1
       ORDER BY observed_at DESC LIMIT ?2`,
    )
    .bind(repositoryId, limit)
    .all<PipelineRunRow>();
  return result.results;
}

export async function latestDefaultBranchRunRow(
  db: D1Database,
  repositoryId: string,
  defaultBranch: string,
): Promise<PipelineRunRow | null> {
  return db
    .prepare(
      `SELECT * FROM pipeline_runs WHERE repository_id = ?1 AND branch = ?2
       ORDER BY observed_at DESC LIMIT 1`,
    )
    .bind(repositoryId, defaultBranch)
    .first<PipelineRunRow>();
}

export interface EstatePipelineRow extends PipelineRunRow {
  full_name: string;
  provider: string;
}

/** Latest observed run per repository, estate-wide (Pipelines page). */
export async function listEstatePipelines(
  db: D1Database,
  limit = 300,
): Promise<EstatePipelineRow[]> {
  const result = await db
    .prepare(
      `SELECT p.*, r.full_name, c.provider_type AS provider
       FROM pipeline_runs p
       JOIN (
         SELECT repository_id, MAX(observed_at) AS max_observed
         FROM pipeline_runs GROUP BY repository_id
       ) latest ON latest.repository_id = p.repository_id AND latest.max_observed = p.observed_at
       JOIN repositories r ON r.id = p.repository_id
       JOIN workspaces w ON w.id = r.workspace_id
       JOIN provider_connections c ON c.id = w.connection_id
       WHERE r.status = 'active'
       ORDER BY CASE WHEN p.conclusion IN ('failure', 'timed_out') THEN 0
                     WHEN p.conclusion = 'cancelled' THEN 1 ELSE 2 END,
                p.observed_at DESC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<EstatePipelineRow>();
  return result.results;
}

/** Retention: delete run summaries past the configured window. */
export async function compactPipelineRuns(db: D1Database, retentionDays: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM pipeline_runs WHERE observed_at < datetime('now', ?1)`,
    )
    .bind(`-${retentionDays} days`)
    .run();
  return result.meta.changes ?? 0;
}
