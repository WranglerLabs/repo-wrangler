import type { SecurityFindingSnapshot } from '@repo-wrangler/domain';

export interface SecurityFindingRow {
  id: string;
  repository_id: string;
  external_id: string;
  category: string;
  severity: string | null;
  state: string | null;
  summary: string | null;
  url: string | null;
  created_at: string | null;
}

export async function upsertSecurityFinding(
  db: D1Database,
  repositoryId: string,
  finding: SecurityFindingSnapshot,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO security_findings (
         id, repository_id, external_id, category, severity, state, rule_id, ref,
         url, summary, created_at, updated_at, resolved_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT (repository_id, category, external_id) DO UPDATE SET
         severity = excluded.severity,
         state = excluded.state,
         rule_id = excluded.rule_id,
         ref = excluded.ref,
         url = excluded.url,
         summary = excluded.summary,
         updated_at = excluded.updated_at,
         resolved_at = excluded.resolved_at,
         observed_at = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(),
      repositoryId,
      finding.externalId,
      finding.category,
      finding.severity ?? null,
      finding.state ?? null,
      finding.ruleId ?? null,
      finding.ref ?? null,
      finding.url ?? null,
      finding.summary ?? null,
      finding.createdAt ?? null,
      finding.updatedAt ?? null,
      finding.resolvedAt ?? null,
    )
    .run();
}

export async function listOpenSecurityFindings(
  db: D1Database,
  repositoryId: string,
): Promise<SecurityFindingRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM security_findings
       WHERE repository_id = ?1 AND (state = 'open' OR state IS NULL)
       ORDER BY created_at DESC`,
    )
    .bind(repositoryId)
    .all<SecurityFindingRow>();
  return result.results;
}
