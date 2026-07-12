/** Checkpointed, claimable sync jobs. Every scan is bounded and resumable. */

export interface SyncJobRow {
  id: string;
  job_type: string;
  priority: number;
  scope: string | null;
  state: string;
  cursor: string | null;
  attempts: number;
  last_error: string | null;
}

export async function enqueueSyncJob(
  db: D1Database,
  jobType: string,
  scope: string,
  priority = 5,
): Promise<void> {
  // Avoid duplicate pending jobs for the same work.
  const existing = await db
    .prepare(
      `SELECT id FROM sync_jobs WHERE job_type = ?1 AND scope = ?2 AND state = 'pending' LIMIT 1`,
    )
    .bind(jobType, scope)
    .first<{ id: string }>();
  if (existing) return;
  await db
    .prepare(
      `INSERT INTO sync_jobs (id, job_type, priority, scope) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(crypto.randomUUID(), jobType, priority, scope)
    .run();
}

/** Claim the highest-priority eligible job. Also reclaims stuck running jobs. */
export async function claimNextSyncJob(db: D1Database): Promise<SyncJobRow | null> {
  // Reclaim jobs stuck in running for over 10 minutes (isolate died mid-run).
  await db
    .prepare(
      `UPDATE sync_jobs SET state = 'pending'
       WHERE state = 'running' AND started_at < datetime('now', '-10 minutes')`,
    )
    .run();

  const job = await db
    .prepare(
      `SELECT * FROM sync_jobs
       WHERE state = 'pending' AND next_eligible_at <= datetime('now')
       ORDER BY priority ASC, created_at ASC LIMIT 1`,
    )
    .first<SyncJobRow>();
  if (!job) return null;

  const claimed = await db
    .prepare(
      `UPDATE sync_jobs SET state = 'running', started_at = datetime('now'),
         attempts = attempts + 1
       WHERE id = ?1 AND state = 'pending'`,
    )
    .bind(job.id)
    .run();
  return (claimed.meta.changes ?? 0) > 0 ? job : null;
}

/** Persist a continuation cursor and release the job for the next invocation. */
export async function checkpointSyncJob(
  db: D1Database,
  id: string,
  cursor: string,
  subrequestsUsed: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_jobs SET state = 'pending', cursor = ?2,
         subrequests_used = subrequests_used + ?3, next_eligible_at = datetime('now')
       WHERE id = ?1`,
    )
    .bind(id, cursor, subrequestsUsed)
    .run();
}

export async function completeSyncJob(
  db: D1Database,
  id: string,
  subrequestsUsed: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_jobs SET state = 'done', finished_at = datetime('now'),
         subrequests_used = subrequests_used + ?2
       WHERE id = ?1`,
    )
    .bind(id, subrequestsUsed)
    .run();
}

export async function failSyncJob(db: D1Database, id: string, error: string): Promise<void> {
  // Back off 15 minutes per attempt; give up after 5 attempts.
  await db
    .prepare(
      `UPDATE sync_jobs SET
         state = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
         last_error = ?2,
         next_eligible_at = datetime('now', '+' || (attempts * 15) || ' minutes'),
         finished_at = CASE WHEN attempts >= 5 THEN datetime('now') ELSE NULL END
       WHERE id = ?1`,
    )
    .bind(id, error.slice(0, 500))
    .run();
}

export interface SyncStats {
  pendingJobs: number;
  runningJobs: number;
  failedJobs: number;
}

export async function getSyncStats(db: D1Database): Promise<SyncStats> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM sync_jobs WHERE state = 'pending') AS pendingJobs,
         (SELECT COUNT(*) FROM sync_jobs WHERE state = 'running') AS runningJobs,
         (SELECT COUNT(*) FROM sync_jobs WHERE state = 'failed') AS failedJobs`,
    )
    .first<SyncStats>();
  return row ?? { pendingJobs: 0, runningJobs: 0, failedJobs: 0 };
}

export async function compactSyncJobs(db: D1Database, retentionDays: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM sync_jobs WHERE state IN ('done', 'failed')
       AND finished_at < datetime('now', ?1)`,
    )
    .bind(`-${retentionDays} days`)
    .run();
  return result.meta.changes ?? 0;
}
