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

export interface EstateSecurityRow extends SecurityFindingRow {
  full_name: string;
  provider: string;
}

/** Open security findings estate-wide (Security page). */
export async function listEstateSecurityFindings(
  db: D1Database,
  limit = 300,
): Promise<EstateSecurityRow[]> {
  const result = await db
    .prepare(
      `SELECT s.*, r.full_name, c.provider_type AS provider
       FROM security_findings s
       JOIN repositories r ON r.id = s.repository_id
       JOIN workspaces w ON w.id = r.workspace_id
       JOIN provider_connections c ON c.id = w.connection_id
       WHERE (s.state = 'open' OR s.state IS NULL) AND r.status = 'active'
       ORDER BY CASE s.category WHEN 'secret_scanning' THEN 0 ELSE 1 END,
                CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                WHEN 'medium' THEN 2 ELSE 3 END,
                s.created_at DESC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<EstateSecurityRow>();
  return result.results;
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
