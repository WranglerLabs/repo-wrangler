import type { BranchSnapshot } from '@repo-wrangler/domain';

export interface BranchRow {
  id: string;
  repository_id: string;
  name: string;
  head_sha: string | null;
  head_committed_at: string | null;
  is_default: number;
  is_protected: number;
  ahead_by: number | null;
  behind_by: number | null;
  comparison_status: string | null;
  compared_at: string | null;
  open_change_request_number: number | null;
  excluded: number;
  excluded_reason: string | null;
  status: string;
}

export async function upsertBranch(
  db: D1Database,
  repositoryId: string,
  branch: BranchSnapshot,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO branches (
         id, repository_id, name, head_sha, head_committed_at, is_default, is_protected,
         ahead_by, behind_by, comparison_status, compared_at, open_change_request_number,
         excluded, excluded_reason, status
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'active')
       ON CONFLICT (repository_id, name) DO UPDATE SET
         head_sha = excluded.head_sha,
         head_committed_at = excluded.head_committed_at,
         is_default = excluded.is_default,
         is_protected = excluded.is_protected,
         ahead_by = excluded.ahead_by,
         behind_by = excluded.behind_by,
         comparison_status = excluded.comparison_status,
         compared_at = excluded.compared_at,
         open_change_request_number = excluded.open_change_request_number,
         excluded = excluded.excluded,
         excluded_reason = excluded.excluded_reason,
         status = 'active',
         last_seen_at = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(),
      repositoryId,
      branch.name,
      branch.headSha ?? null,
      branch.headCommittedAt ?? null,
      branch.isDefault ? 1 : 0,
      branch.isProtected ? 1 : 0,
      branch.aheadBy ?? null,
      branch.behindBy ?? null,
      branch.comparisonStatus,
      branch.comparedAt ?? null,
      branch.openChangeRequestNumber ?? null,
      branch.excluded ? 1 : 0,
      branch.excludedReason ?? null,
    )
    .run();
}

/** A push moves the head and invalidates the previous comparison. */
export async function applyBranchPush(
  db: D1Database,
  repositoryId: string,
  branchName: string,
  headSha: string,
  pushedAt?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO branches (id, repository_id, name, head_sha, head_committed_at, comparison_status, status)
       VALUES (?1, ?2, ?3, ?4, ?5, 'unknown', 'active')
       ON CONFLICT (repository_id, name) DO UPDATE SET
         head_sha = excluded.head_sha,
         head_committed_at = COALESCE(excluded.head_committed_at, branches.head_committed_at),
         comparison_status = 'unknown',
         compared_at = NULL,
         status = 'active',
         last_seen_at = datetime('now')`,
    )
    .bind(crypto.randomUUID(), repositoryId, branchName, headSha, pushedAt ?? null)
    .run();
}

export async function markBranchDeleted(
  db: D1Database,
  repositoryId: string,
  branchName: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE branches SET status = 'deleted', last_seen_at = datetime('now')
       WHERE repository_id = ?1 AND name = ?2`,
    )
    .bind(repositoryId, branchName)
    .run();
}

export async function listBranches(
  db: D1Database,
  repositoryId: string,
): Promise<BranchRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM branches WHERE repository_id = ?1 AND status = 'active'
       ORDER BY is_default DESC, name`,
    )
    .bind(repositoryId)
    .all<BranchRow>();
  return result.results;
}
