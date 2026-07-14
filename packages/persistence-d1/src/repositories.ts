import type { MonitoringState, RepositorySnapshot } from '@repo-wrangler/domain';

export interface RepositoryRow {
  id: string;
  workspace_id: string;
  external_id: string;
  name: string;
  full_name: string;
  url: string | null;
  description: string | null;
  visibility: string | null;
  is_archived: number;
  is_fork: number;
  default_branch: string | null;
  pushed_at: string | null;
  primary_language: string | null;
  topics: string | null;
  license_spdx: string | null;
  monitoring_state: MonitoringState;
  status: string;
  first_seen_at: string;
  snapshot_synced_at: string | null;
  enrich_synced_at: string | null;
}

export async function upsertRepository(
  db: D1Database,
  workspaceId: string,
  snapshot: RepositorySnapshot,
): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM repositories WHERE workspace_id = ?1 AND external_id = ?2`)
    .bind(workspaceId, snapshot.externalId)
    .first<{ id: string }>();

  const topics = JSON.stringify(snapshot.topics ?? []);

  if (existing) {
    await db
      .prepare(
        `UPDATE repositories SET
           node_id = ?2, name = ?3, full_name = ?4, url = ?5, description = ?6,
           visibility = ?7, is_archived = ?8, is_fork = ?9, is_disabled = ?10,
           is_template = ?11, default_branch = ?12, pushed_at = ?13,
           provider_updated_at = ?14, primary_language = ?15, topics = ?16,
           license_spdx = ?17, size_kb = ?18,
           status = 'active', removed_at = NULL,
           last_seen_at = datetime('now'), snapshot_synced_at = datetime('now')
         WHERE id = ?1`,
      )
      .bind(
        existing.id,
        snapshot.nodeId ?? null,
        snapshot.name,
        snapshot.fullName,
        snapshot.url ?? null,
        snapshot.description ?? null,
        snapshot.visibility ?? null,
        snapshot.isArchived ? 1 : 0,
        snapshot.isFork ? 1 : 0,
        snapshot.isDisabled ? 1 : 0,
        snapshot.isTemplate ? 1 : 0,
        snapshot.defaultBranch ?? null,
        snapshot.pushedAt ?? null,
        snapshot.providerUpdatedAt ?? null,
        snapshot.primaryLanguage ?? null,
        topics,
        snapshot.licenseSpdx ?? null,
        snapshot.sizeKb ?? null,
      )
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO repositories (
         id, workspace_id, external_id, node_id, name, full_name, url, description,
         visibility, is_archived, is_fork, is_disabled, is_template, default_branch,
         pushed_at, provider_updated_at, primary_language, topics, license_spdx,
         size_kb, snapshot_synced_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, datetime('now'))`,
    )
    .bind(
      id,
      workspaceId,
      snapshot.externalId,
      snapshot.nodeId ?? null,
      snapshot.name,
      snapshot.fullName,
      snapshot.url ?? null,
      snapshot.description ?? null,
      snapshot.visibility ?? null,
      snapshot.isArchived ? 1 : 0,
      snapshot.isFork ? 1 : 0,
      snapshot.isDisabled ? 1 : 0,
      snapshot.isTemplate ? 1 : 0,
      snapshot.defaultBranch ?? null,
      snapshot.pushedAt ?? null,
      snapshot.providerUpdatedAt ?? null,
      snapshot.primaryLanguage ?? null,
      topics,
      snapshot.licenseSpdx ?? null,
      snapshot.sizeKb ?? null,
    )
    .run();
  return id;
}

/** Tombstone, never delete: a repository that disappeared is marked removed. */
export async function markRepositoryRemoved(
  db: D1Database,
  workspaceId: string,
  externalId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE repositories SET status = 'removed', removed_at = datetime('now')
       WHERE workspace_id = ?1 AND external_id = ?2`,
    )
    .bind(workspaceId, externalId)
    .run();
}

/** After a complete discovery pass, mark unseen-but-known repos inaccessible. */
export async function markUnseenInaccessible(
  db: D1Database,
  workspaceId: string,
  seenExternalIds: string[],
): Promise<void> {
  if (seenExternalIds.length === 0) return;
  const placeholders = seenExternalIds.map((_, i) => `?${i + 2}`).join(', ');
  await db
    .prepare(
      `UPDATE repositories SET status = 'inaccessible'
       WHERE workspace_id = ?1 AND status = 'active' AND external_id NOT IN (${placeholders})`,
    )
    .bind(workspaceId, ...seenExternalIds)
    .run();
}

/**
 * Operator decision, not a discovery event: `updated_at`/`last_seen_at` are
 * left untouched. Returns false if no such repository exists (A1).
 */
export async function setRepositoryMonitoringState(
  db: D1Database,
  id: string,
  state: MonitoringState,
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE repositories SET monitoring_state = ?2 WHERE id = ?1`)
    .bind(id, state)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getRepositoryById(
  db: D1Database,
  id: string,
): Promise<RepositoryRow | null> {
  return db.prepare(`SELECT * FROM repositories WHERE id = ?1`).bind(id).first<RepositoryRow>();
}

export async function getRepositoryByFullName(
  db: D1Database,
  fullName: string,
): Promise<RepositoryRow | null> {
  return db
    .prepare(`SELECT * FROM repositories WHERE full_name = ?1 LIMIT 1`)
    .bind(fullName)
    .first<RepositoryRow>();
}

export async function getRepositoryByExternalId(
  db: D1Database,
  workspaceId: string,
  externalId: string,
): Promise<RepositoryRow | null> {
  return db
    .prepare(`SELECT * FROM repositories WHERE workspace_id = ?1 AND external_id = ?2`)
    .bind(workspaceId, externalId)
    .first<RepositoryRow>();
}

/** Bounded batch of repositories most in need of enrichment. */
export async function claimEnrichmentBatch(
  db: D1Database,
  limit: number,
): Promise<RepositoryRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM repositories
       WHERE status = 'active' AND monitoring_state = 'monitored' AND is_archived = 0
       ORDER BY enrich_synced_at ASC NULLS FIRST
       LIMIT ?1`,
    )
    .bind(limit)
    .all<RepositoryRow>();
  return result.results;
}

export async function markEnriched(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE repositories SET enrich_synced_at = datetime('now') WHERE id = ?1`)
    .bind(id)
    .run();
}

/** Store the governance capability snapshot (JSON) for a repository. */
export async function setRepositoryGovernance(
  db: D1Database,
  id: string,
  governanceJson: string,
): Promise<void> {
  await db
    .prepare(`UPDATE repositories SET governance = ?2 WHERE id = ?1`)
    .bind(id, governanceJson)
    .run();
}

export async function getRepositoryGovernance(
  db: D1Database,
  id: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT governance FROM repositories WHERE id = ?1`)
    .bind(id)
    .first<{ governance: string | null }>();
  return row?.governance ?? null;
}

export interface RepositoryListRow extends RepositoryRow {
  workspace_slug: string;
  provider: string;
  attention_level: string | null;
  branches_ahead: number;
  diverged_count: number;
  untracked_count: number;
  considered_count: number;
  unknown_count: number;
  open_crs: number;
  latest_run_conclusion: string | null;
  latest_run_at: string | null;
}

/** Indexed snapshot query behind the estate repository table. */
export async function listRepositoryItems(
  db: D1Database,
  options: { includeArchived?: boolean; includeIgnored?: boolean; limit?: number } = {},
): Promise<RepositoryListRow[]> {
  const limit = options.limit ?? 500;
  const archivedClause = options.includeArchived ? '' : 'AND r.is_archived = 0';
  // A3: the estate table excludes anything ignored, at either level; the
  // management screen (Phase B) passes includeIgnored to list everything
  // with its state attached.
  const monitoringClause = options.includeIgnored
    ? ''
    : `AND r.monitoring_state = 'monitored' AND w.monitoring_state = 'monitored'`;
  const result = await db
    .prepare(
      `SELECT r.*, w.slug AS workspace_slug, c.provider_type AS provider,
         h.attention_level,
         (SELECT COUNT(*) FROM branches b WHERE b.repository_id = r.id AND b.status = 'active'
            AND b.excluded = 0 AND b.comparison_status IN ('ahead', 'diverged')) AS branches_ahead,
         (SELECT COUNT(*) FROM branches b WHERE b.repository_id = r.id AND b.status = 'active'
            AND b.excluded = 0 AND b.comparison_status = 'diverged') AS diverged_count,
         (SELECT COUNT(*) FROM branches b WHERE b.repository_id = r.id AND b.status = 'active'
            AND b.excluded = 0 AND b.comparison_status = 'ahead'
            AND b.open_change_request_number IS NULL) AS untracked_count,
         (SELECT COUNT(*) FROM branches b WHERE b.repository_id = r.id AND b.status = 'active'
            AND b.excluded = 0 AND b.is_default = 0) AS considered_count,
         (SELECT COUNT(*) FROM branches b WHERE b.repository_id = r.id AND b.status = 'active'
            AND b.excluded = 0 AND b.is_default = 0 AND b.comparison_status = 'unknown') AS unknown_count,
         (SELECT COUNT(*) FROM change_requests cr WHERE cr.repository_id = r.id AND cr.state = 'open') AS open_crs,
         (SELECT p.conclusion FROM pipeline_runs p WHERE p.repository_id = r.id
            AND p.branch = r.default_branch ORDER BY p.observed_at DESC LIMIT 1) AS latest_run_conclusion,
         (SELECT p.run_started_at FROM pipeline_runs p WHERE p.repository_id = r.id
            AND p.branch = r.default_branch ORDER BY p.observed_at DESC LIMIT 1) AS latest_run_at
       FROM repositories r
       JOIN workspaces w ON w.id = r.workspace_id
       JOIN provider_connections c ON c.id = w.connection_id
       LEFT JOIN health_snapshots h ON h.repository_id = r.id
       WHERE r.status IN ('active', 'inaccessible') ${archivedClause} ${monitoringClause}
       ORDER BY r.full_name
       LIMIT ?1`,
    )
    .bind(limit)
    .all<RepositoryListRow>();
  return result.results;
}

export interface OverviewCounts {
  workspaces: number;
  repositories: number;
  failing: number;
  openCrs: number;
  branchesAhead: number;
  securityOpen: number;
  new7d: number;
  inaccessible: number;
}

export async function getOverviewCounts(db: D1Database): Promise<OverviewCounts> {
  // A3: workspaces/repositories/failing/new7d exclude ignored rows — both an
  // ignored repository directly and any repository under an ignored
  // workspace. openCrs/branchesAhead/securityOpen/inaccessible are unscoped
  // per the design (not estate-membership counts).
  const monitoredWorkspaceIds = `(SELECT id FROM workspaces WHERE monitoring_state = 'monitored')`;
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM workspaces WHERE status = 'active'
            AND monitoring_state = 'monitored') AS workspaces,
         (SELECT COUNT(*) FROM repositories WHERE status = 'active' AND is_archived = 0
            AND monitoring_state = 'monitored'
            AND workspace_id IN ${monitoredWorkspaceIds}) AS repositories,
         (SELECT COUNT(*) FROM repositories r WHERE r.status = 'active' AND r.is_archived = 0
            AND r.monitoring_state = 'monitored'
            AND r.workspace_id IN ${monitoredWorkspaceIds} AND (
            SELECT p.conclusion FROM pipeline_runs p
            WHERE p.repository_id = r.id AND p.branch = r.default_branch
            ORDER BY p.observed_at DESC LIMIT 1) IN ('failure', 'timed_out')) AS failing,
         (SELECT COUNT(*) FROM change_requests WHERE state = 'open') AS openCrs,
         (SELECT COUNT(*) FROM branches WHERE status = 'active' AND excluded = 0
            AND comparison_status IN ('ahead', 'diverged')) AS branchesAhead,
         (SELECT COUNT(*) FROM security_findings WHERE state = 'open' OR state IS NULL) AS securityOpen,
         (SELECT COUNT(*) FROM repositories WHERE status = 'active'
            AND monitoring_state = 'monitored' AND workspace_id IN ${monitoredWorkspaceIds}
            AND first_seen_at >= datetime('now', '-7 days')) AS new7d,
         (SELECT COUNT(*) FROM repositories WHERE status = 'inaccessible') AS inaccessible`,
    )
    .first<OverviewCounts>();
  return (
    row ?? {
      workspaces: 0,
      repositories: 0,
      failing: 0,
      openCrs: 0,
      branchesAhead: 0,
      securityOpen: 0,
      new7d: 0,
      inaccessible: 0,
    }
  );
}
