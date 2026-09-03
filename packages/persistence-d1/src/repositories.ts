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
  last_seen_at: string;
  removed_at: string | null;
  snapshot_synced_at: string | null;
  enrich_synced_at: string | null;
  status_reason: string | null;
  state_changed_at: string | null;
  last_reconciled_at: string | null;
}

export async function upsertRepository(
  db: D1Database,
  workspaceId: string,
  snapshot: RepositorySnapshot,
): Promise<string> {
  const scope = await db.prepare('SELECT connection_id FROM workspaces WHERE id = ?1')
    .bind(workspaceId).first<{ connection_id: string }>();
  if (!scope) throw new Error(`Workspace ${workspaceId} does not exist.`);

  let existing = await db.prepare(
    `SELECT r.id, r.workspace_id, r.full_name FROM repository_provider_identities i
     JOIN repositories r ON r.id = i.repository_id
     WHERE i.connection_id = ?1 AND i.external_id = ?2`,
  ).bind(scope.connection_id, snapshot.externalId)
    .first<{ id: string; workspace_id: string; full_name: string }>();
  existing ??= await db.prepare(
    `SELECT id, workspace_id, full_name FROM repositories WHERE workspace_id = ?1 AND external_id = ?2`,
  ).bind(workspaceId, snapshot.externalId)
    .first<{ id: string; workspace_id: string; full_name: string }>();

  const topics = JSON.stringify(snapshot.topics ?? []);

  if (existing) {
    if (existing.workspace_id !== workspaceId) {
      const collision = await db.prepare(
        'SELECT id, full_name FROM repositories WHERE workspace_id = ?1 AND external_id = ?2 AND id != ?3',
      ).bind(workspaceId, snapshot.externalId, existing.id)
        .first<{ id: string; full_name: string }>();
      if (collision) {
        await db.prepare(
          `INSERT INTO repository_move_history (
             id, repository_id, from_workspace_id, to_workspace_id,
             provider_full_name_before, provider_full_name_after
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(
          crypto.randomUUID(), collision.id, existing.workspace_id, workspaceId,
          existing.full_name, snapshot.fullName,
        ).run();
        await db.prepare(
          `UPDATE repositories SET status = 'removed', status_reason = 'duplicate_merged',
             state_changed_at = datetime('now'), removed_at = COALESCE(removed_at, datetime('now'))
           WHERE id = ?1`,
        ).bind(existing.id).run();
        existing = { id: collision.id, workspace_id: workspaceId, full_name: collision.full_name };
        await db.prepare(
          `UPDATE repository_provider_identities SET repository_id = ?3, last_seen_at = datetime('now')
           WHERE connection_id = ?1 AND external_id = ?2`,
        ).bind(scope.connection_id, snapshot.externalId, collision.id).run();
      } else {
        await db.prepare(
          `INSERT INTO repository_move_history (
             id, repository_id, from_workspace_id, to_workspace_id,
             provider_full_name_before, provider_full_name_after
           ) SELECT ?1, id, workspace_id, ?2, full_name, ?3 FROM repositories WHERE id = ?4`,
        ).bind(crypto.randomUUID(), workspaceId, snapshot.fullName, existing.id).run();
        await db.prepare('UPDATE repositories SET workspace_id = ?2 WHERE id = ?1')
          .bind(existing.id, workspaceId).run();
      }
    }
    await db
      .prepare(
        `UPDATE repositories SET
           node_id = ?2, name = ?3, full_name = ?4, url = ?5, description = ?6,
           visibility = ?7, is_archived = ?8, is_fork = ?9, is_disabled = ?10,
           is_template = ?11, default_branch = ?12, pushed_at = ?13,
           provider_updated_at = ?14, primary_language = ?15, topics = ?16,
           license_spdx = ?17, size_kb = ?18,
           status = 'active', status_reason = NULL, removed_at = NULL,
           state_changed_at = CASE WHEN status != 'active' OR status_reason IS NOT NULL
             THEN datetime('now') ELSE state_changed_at END,
           last_seen_at = datetime('now'), last_reconciled_at = datetime('now'),
           snapshot_synced_at = datetime('now')
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
    await db.prepare(
      `INSERT INTO repository_provider_identities (connection_id, external_id, repository_id)
       VALUES (?1, ?2, ?3)
       ON CONFLICT (connection_id, external_id) DO UPDATE SET
         repository_id = excluded.repository_id, last_seen_at = datetime('now')`,
    ).bind(scope.connection_id, snapshot.externalId, existing.id).run();
    await refreshRepositoryBudgetAttributions(db, existing.id, workspaceId);
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
  await db.prepare(
    `INSERT INTO repository_provider_identities (connection_id, external_id, repository_id)
     VALUES (?1, ?2, ?3)`,
  ).bind(scope.connection_id, snapshot.externalId, id).run();
  await refreshRepositoryBudgetAttributions(db, id, workspaceId);
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
      `UPDATE repositories SET status = 'removed', status_reason = 'provider_resource_deleted',
         state_changed_at = CASE WHEN status != 'removed' THEN datetime('now') ELSE state_changed_at END,
         removed_at = COALESCE(removed_at, datetime('now')), last_reconciled_at = datetime('now')
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
): Promise<number> {
  const exclusion = seenExternalIds.length === 0
    ? ''
    : `AND external_id NOT IN (${seenExternalIds.map((_, i) => `?${i + 2}`).join(', ')})`;
  const result = await db
    .prepare(
      `UPDATE repositories SET status = 'inaccessible', status_reason = 'not_seen_after_complete_discovery',
         state_changed_at = datetime('now'), last_reconciled_at = datetime('now')
       WHERE workspace_id = ?1 AND status = 'active' ${exclusion}`,
    )
    .bind(workspaceId, ...seenExternalIds)
    .run();
  return result.meta.changes ?? 0;
}

export interface ConnectionRepositoryRow {
  id: string;
  full_name: string;
  workspace_slug: string;
  monitoring_state: MonitoringState;
  status: string;
  status_reason: string | null;
  first_seen_at: string;
  last_seen_at: string;
  state_changed_at: string | null;
  removed_at: string | null;
  last_reconciled_at: string | null;
}

async function refreshRepositoryBudgetAttributions(
  db: D1Database,
  repositoryId: string,
  workspaceId: string,
): Promise<void> {
  await db.prepare('DELETE FROM budget_repository_attributions WHERE repository_id = ?1')
    .bind(repositoryId).run();
  await db.prepare(
    `UPDATE budgets SET repository_id = NULL
     WHERE repository_id = ?1 AND workspace_id != ?2`,
  ).bind(repositoryId, workspaceId).run();
  await db.prepare(
    `UPDATE budgets SET repository_id = ?1
     WHERE workspace_id = ?2 AND lower(COALESCE(scope_type, '')) IN ('repository', 'repo')
       AND EXISTS (
         SELECT 1 FROM repositories r WHERE r.id = ?1
           AND (lower(budgets.scope_entity_name) = lower(r.full_name)
             OR lower(budgets.scope_entity_name) = lower(r.name)
             OR lower(budgets.scope_target) = lower(r.full_name)
             OR lower(budgets.scope_target) = lower(r.name))
       )`,
  ).bind(repositoryId, workspaceId).run();
  await db.prepare(
    `INSERT INTO budget_repository_attributions (budget_id, repository_id, attribution_type)
     SELECT id, ?1, CASE WHEN repository_id = ?1 THEN 'direct' ELSE 'inherited' END
     FROM budgets
     WHERE workspace_id = ?2 AND (
       repository_id = ?1 OR lower(COALESCE(scope_type, '')) IN
         ('organization', 'org', 'enterprise', 'cost_center')
     )
     ON CONFLICT (budget_id, repository_id) DO UPDATE SET
       attribution_type = excluded.attribution_type`,
  ).bind(repositoryId, workspaceId).run();
}

/** Complete current and historical inventory for one provider connection. */
export async function listConnectionRepositories(
  db: D1Database,
  connectionId: string,
): Promise<ConnectionRepositoryRow[]> {
  const result = await db.prepare(
    `SELECT r.id, r.full_name, w.slug AS workspace_slug, r.monitoring_state,
            r.status, r.status_reason, r.first_seen_at, r.last_seen_at,
            r.state_changed_at, r.removed_at, r.last_reconciled_at
     FROM repositories r
     JOIN workspaces w ON w.id = r.workspace_id
     WHERE w.connection_id = ?1
     ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'inaccessible' THEN 1 ELSE 2 END,
              lower(r.full_name)`,
  ).bind(connectionId).all<ConnectionRepositoryRow>();
  return result.results;
}

export async function getRepositoryDiscoveryState(
  db: D1Database,
  connectionId: string,
  externalId: string,
): Promise<{ id: string; workspace_id: string; full_name: string; status: string } | null> {
  return db.prepare(
    `SELECT r.id, r.workspace_id, r.full_name, r.status
     FROM repository_provider_identities i JOIN repositories r ON r.id = i.repository_id
     WHERE i.connection_id = ?1 AND i.external_id = ?2`,
  ).bind(connectionId, externalId)
    .first<{ id: string; workspace_id: string; full_name: string; status: string }>();
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
  const result = await db
    .prepare(`SELECT * FROM repositories WHERE full_name = ?1 ORDER BY id LIMIT 2`)
    .bind(fullName)
    .all<RepositoryRow>();
  return result.results.length === 1 ? result.results[0]! : null;
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

/**
 * Every active, monitored, non-archived repository in a workspace — the set
 * a discovery pass should chain `enrich_repository` jobs for (B3b), as
 * opposed to `claimEnrichmentBatch`'s globally-bounded periodic sample.
 */
export async function listActiveMonitoredRepositories(
  db: D1Database,
  workspaceId: string,
): Promise<RepositoryRow[]> {
  const result = await db
    .prepare(
      `SELECT r.* FROM repositories r
       JOIN workspaces w ON w.id = r.workspace_id
       JOIN provider_connections c ON c.id = w.connection_id
       WHERE r.workspace_id = ?1 AND r.status = 'active'
         AND r.monitoring_state = 'monitored' AND r.is_archived = 0
         AND w.status = 'active' AND w.monitoring_state = 'monitored'
         AND c.status = 'active'`,
    )
    .bind(workspaceId)
    .all<RepositoryRow>();
  return result.results;
}

/** Bounded batch of repositories most in need of enrichment. */
export async function claimEnrichmentBatch(
  db: D1Database,
  limit: number,
): Promise<RepositoryRow[]> {
  const result = await db
    .prepare(
      `SELECT r.* FROM repositories r
       JOIN workspaces w ON w.id = r.workspace_id
       JOIN provider_connections c ON c.id = w.connection_id
       WHERE r.status = 'active' AND r.monitoring_state = 'monitored' AND r.is_archived = 0
         AND w.status = 'active' AND w.monitoring_state = 'monitored'
         AND c.status = 'active'
       ORDER BY r.enrich_synced_at ASC NULLS FIRST
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
       WHERE r.status IN ('active', 'inaccessible')
         AND w.status = 'active' AND c.status = 'active'
         ${archivedClause} ${monitoringClause}
       ORDER BY r.full_name
       LIMIT ?1`,
    )
    .bind(limit)
    .all<RepositoryListRow>();
  return result.results;
}

/**
 * Onboarding design Phase C2 — repositories first seen after the operator's
 * last review, across every connection. A flat, lightweight projection (no
 * branch/CR sub-counts) since this is a "what's new" surface, not the estate
 * table; `rowToListItem` (apps/worker) tolerates the zeroed/absent columns.
 */
export async function listNewSinceReview(
  db: D1Database,
  since: string,
): Promise<RepositoryListRow[]> {
  const result = await db
    .prepare(
      `SELECT r.*, w.slug AS workspace_slug, c.provider_type AS provider,
         h.attention_level,
         0 AS branches_ahead, 0 AS diverged_count, 0 AS untracked_count,
         0 AS considered_count, 0 AS unknown_count, 0 AS open_crs,
         NULL AS latest_run_conclusion, NULL AS latest_run_at
       FROM repositories r
       JOIN workspaces w ON w.id = r.workspace_id
       JOIN provider_connections c ON c.id = w.connection_id
       LEFT JOIN health_snapshots h ON h.repository_id = r.id
       WHERE r.status IN ('active', 'inaccessible') AND w.status = 'active'
         AND c.status = 'active' AND r.first_seen_at > ?1
       ORDER BY r.first_seen_at DESC
       LIMIT 200`,
    )
    .bind(since)
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
  const monitoredWorkspaceIds = `(SELECT w.id FROM workspaces w
    JOIN provider_connections c ON c.id = w.connection_id
    WHERE w.status = 'active' AND w.monitoring_state = 'monitored' AND c.status = 'active')`;
  const activeConnectionWorkspaceIds = `(SELECT w.id FROM workspaces w
    JOIN provider_connections c ON c.id = w.connection_id WHERE c.status = 'active')`;
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM workspaces WHERE id IN ${monitoredWorkspaceIds}) AS workspaces,
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
         (SELECT COUNT(*) FROM repositories WHERE status = 'inaccessible'
            AND workspace_id IN ${activeConnectionWorkspaceIds}) AS inaccessible`,
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
