import type { HealthFinding, AttentionLevel } from '@repo-wrangler/domain';

export async function getAttentionLevel(
  db: D1Database,
  repositoryId: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT attention_level FROM health_snapshots WHERE repository_id = ?1`)
    .bind(repositoryId)
    .first<{ attention_level: string }>();
  return row?.attention_level ?? null;
}

export async function upsertHealthSnapshot(
  db: D1Database,
  repositoryId: string,
  level: AttentionLevel,
  findings: HealthFinding[],
  policyVersion: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO health_snapshots (repository_id, attention_level, findings, policy_version, evaluated_at)
       VALUES (?1, ?2, ?3, ?4, datetime('now'))
       ON CONFLICT (repository_id) DO UPDATE SET
         attention_level = excluded.attention_level,
         findings = excluded.findings,
         policy_version = excluded.policy_version,
         evaluated_at = datetime('now')`,
    )
    .bind(repositoryId, level, JSON.stringify(findings), policyVersion)
    .run();
}

export async function getHealthFindings(
  db: D1Database,
  repositoryId: string,
): Promise<HealthFinding[]> {
  const row = await db
    .prepare(`SELECT findings FROM health_snapshots WHERE repository_id = ?1`)
    .bind(repositoryId)
    .first<{ findings: string }>();
  if (!row) return [];
  try {
    return JSON.parse(row.findings) as HealthFinding[];
  } catch {
    return [];
  }
}

export async function getAttentionLevelCounts(db: D1Database): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      `SELECT h.attention_level AS level, COUNT(*) AS count
       FROM health_snapshots h
       JOIN repositories r ON r.id = h.repository_id
       WHERE r.status = 'active' AND r.is_archived = 0
       GROUP BY h.attention_level`,
    )
    .all<{ level: string; count: number }>();
  const counts: Record<string, number> = {};
  for (const row of result.results) counts[row.level] = row.count;
  return counts;
}

export interface AttentionRow {
  repository_id: string;
  full_name: string;
  url: string | null;
  provider: string;
  findings: string;
  evaluated_at: string;
}

export async function listAttentionRows(db: D1Database, limit = 100): Promise<AttentionRow[]> {
  const result = await db
    .prepare(
      `SELECT h.repository_id, r.full_name, r.url, c.provider_type AS provider,
              h.findings, h.evaluated_at
       FROM health_snapshots h
       JOIN repositories r ON r.id = h.repository_id
       JOIN workspaces w ON w.id = r.workspace_id
       JOIN provider_connections c ON c.id = w.connection_id
       WHERE r.status = 'active' AND h.attention_level IN ('critical', 'high', 'medium', 'low')
       ORDER BY CASE h.attention_level
         WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         h.evaluated_at DESC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<AttentionRow>();
  return result.results;
}
