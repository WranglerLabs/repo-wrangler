import type { ChangeRequestSnapshot } from '@repo-wrangler/domain';

export interface ChangeRequestRow {
  id: string;
  repository_id: string;
  number: number;
  title: string | null;
  url: string | null;
  author: string | null;
  is_draft: number;
  state: string;
  base_ref: string | null;
  head_ref: string | null;
  review_decision: string | null;
  mergeable_state: string | null;
  checks_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_stale: number;
}

export async function upsertChangeRequest(
  db: D1Database,
  repositoryId: string,
  cr: ChangeRequestSnapshot,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO change_requests (
         id, repository_id, number, title, url, author, is_draft, state, base_ref,
         head_ref, head_sha, review_decision, requested_reviewers, mergeable_state,
         checks_status, created_at, updated_at, merged_at, closed_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
       ON CONFLICT (repository_id, number) DO UPDATE SET
         title = excluded.title,
         url = excluded.url,
         author = excluded.author,
         is_draft = excluded.is_draft,
         state = excluded.state,
         base_ref = excluded.base_ref,
         head_ref = excluded.head_ref,
         head_sha = excluded.head_sha,
         review_decision = excluded.review_decision,
         requested_reviewers = excluded.requested_reviewers,
         mergeable_state = excluded.mergeable_state,
         checks_status = excluded.checks_status,
         updated_at = excluded.updated_at,
         merged_at = excluded.merged_at,
         closed_at = excluded.closed_at,
         observed_at = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(),
      repositoryId,
      cr.number,
      cr.title ?? null,
      cr.url ?? null,
      cr.author ?? null,
      cr.isDraft ? 1 : 0,
      cr.state,
      cr.baseRef ?? null,
      cr.headRef ?? null,
      cr.headSha ?? null,
      cr.reviewDecision ?? null,
      JSON.stringify(cr.requestedReviewers ?? []),
      cr.mergeableState ?? null,
      cr.checksStatus ?? null,
      cr.createdAt ?? null,
      cr.updatedAt ?? null,
      cr.mergedAt ?? null,
      cr.closedAt ?? null,
    )
    .run();

  // Keep branch → open change request linkage current for FR-005.
  if (cr.headRef) {
    if (cr.state === 'open') {
      await db
        .prepare(
          `UPDATE branches SET open_change_request_number = ?3
           WHERE repository_id = ?1 AND name = ?2`,
        )
        .bind(repositoryId, cr.headRef, cr.number)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE branches SET open_change_request_number = NULL
           WHERE repository_id = ?1 AND name = ?2 AND open_change_request_number = ?3`,
        )
        .bind(repositoryId, cr.headRef, cr.number)
        .run();
    }
  }
}

export async function listOpenChangeRequests(
  db: D1Database,
  repositoryId: string,
): Promise<ChangeRequestRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM change_requests WHERE repository_id = ?1 AND state = 'open'
       ORDER BY updated_at DESC`,
    )
    .bind(repositoryId)
    .all<ChangeRequestRow>();
  return result.results;
}

/** Retention: remove closed/merged summaries past the window. */
export async function compactChangeRequests(
  db: D1Database,
  retentionDays: number,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM change_requests
       WHERE state IN ('merged', 'closed') AND observed_at < datetime('now', ?1)`,
    )
    .bind(`-${retentionDays} days`)
    .run();
  return result.meta.changes ?? 0;
}
