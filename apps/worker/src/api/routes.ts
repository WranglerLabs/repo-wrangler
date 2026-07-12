import { Hono } from 'hono';
import type {
  AttentionItemDto,
  OverviewDto,
  PlatformHealthDto,
  RepositoryDetailDto,
  RepositoryListItemDto,
  WorkspaceDto,
} from '@repo-wrangler/contracts';
import type { HealthFinding } from '@repo-wrangler/domain';
import {
  getAttentionLevelCounts,
  getHealthFindings,
  getOverviewCounts,
  getRepositoryById,
  getSyncStats,
  getWebhookStats,
  listAttentionRows,
  listBranches,
  listConnections,
  listOpenChangeRequests,
  listOpenSecurityFindings,
  listRecentRuns,
  listRepositoryItems,
  listWorkspaceRows,
  enqueueSyncJob,
  recordAuditEvent,
  type RepositoryListRow,
} from '@repo-wrangler/persistence-d1';
import {
  demoAttention,
  demoOverview,
  demoPlatformHealth,
  demoRepositories,
  demoRepositoryDetail,
  demoWorkspaces,
} from '@repo-wrangler/provider-mock';
import { CREDITS } from '@repo-wrangler/credits';
import { APP_VERSION, isDemoMode } from '../bindings';
import { requireAdmin, type AppContext } from '../middleware/auth';

export const apiRoutes = new Hono<AppContext>();

function deriveDefaultBranchStatus(
  row: RepositoryListRow,
): RepositoryListItemDto['defaultBranchStatus'] {
  if (row.considered_count === 0) return 'current';
  if (row.diverged_count > 0) return 'diverged';
  if (row.untracked_count > 0) return 'untracked_work';
  if (row.branches_ahead > 0) return 'work_pending';
  if (row.unknown_count === row.considered_count) return 'unknown';
  return 'current';
}

function rowToListItem(row: RepositoryListRow): RepositoryListItemDto {
  return {
    id: row.id,
    provider: row.provider,
    workspaceSlug: row.workspace_slug,
    name: row.name,
    fullName: row.full_name,
    url: row.url ?? undefined,
    visibility: row.visibility ?? undefined,
    isArchived: row.is_archived === 1,
    defaultBranch: row.default_branch ?? undefined,
    defaultBranchStatus: deriveDefaultBranchStatus(row),
    branchesAhead: row.branches_ahead,
    latestRunConclusion: row.latest_run_conclusion ?? undefined,
    latestRunAt: row.latest_run_at ?? undefined,
    openChangeRequests: row.open_crs,
    attentionLevel: (row.attention_level ?? 'unknown') as RepositoryListItemDto['attentionLevel'],
    primaryLanguage: row.primary_language ?? undefined,
    pushedAt: row.pushed_at ?? undefined,
    lastSyncedAt: row.enrich_synced_at ?? row.snapshot_synced_at ?? undefined,
    status: row.status,
  };
}

apiRoutes.get('/overview', async (c) => {
  if (isDemoMode(c.env)) return c.json(demoOverview());
  const counts = await getOverviewCounts(c.env.DB);
  const attentionCounts = await getAttentionLevelCounts(c.env.DB);
  const body: OverviewDto = {
    workspaces: counts.workspaces,
    repositories: counts.repositories,
    failingPipelines: counts.failing,
    openChangeRequests: counts.openCrs,
    branchesAhead: counts.branchesAhead,
    securityFindings:
      counts.securityOpen > 0
        ? { state: 'available', count: counts.securityOpen }
        : { state: 'not_configured' },
    budgetWarnings: { state: 'not_configured' },
    newRepositories7d: counts.new7d,
    inaccessibleRepositories: counts.inaccessible,
    attentionCounts,
    generatedAt: new Date().toISOString(),
  };
  return c.json(body);
});

apiRoutes.get('/attention', async (c) => {
  if (isDemoMode(c.env)) return c.json(demoAttention());
  const rows = await listAttentionRows(c.env.DB);
  const items: AttentionItemDto[] = [];
  for (const row of rows) {
    let findings: HealthFinding[] = [];
    try {
      findings = JSON.parse(row.findings) as HealthFinding[];
    } catch {
      continue;
    }
    for (const finding of findings) {
      if (finding.severity === 'info') continue;
      items.push({
        severity: finding.severity,
        code: finding.code,
        message: finding.message,
        repositoryId: row.repository_id,
        repositoryFullName: row.full_name,
        provider: row.provider,
        url: row.url ?? undefined,
        observedAt: row.evaluated_at,
      });
    }
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return c.json(items);
});

apiRoutes.get('/repositories', async (c) => {
  if (isDemoMode(c.env)) return c.json(demoRepositories());
  const includeArchived = c.req.query('archived') === 'true';
  const rows = await listRepositoryItems(c.env.DB, { includeArchived });
  return c.json(rows.map(rowToListItem));
});

apiRoutes.get('/repositories/:id', async (c) => {
  const id = c.req.param('id');
  if (isDemoMode(c.env)) {
    const detail = demoRepositoryDetail(id);
    return detail ? c.json(detail) : c.json({ error: 'not found' }, 404);
  }

  const repo = await getRepositoryById(c.env.DB, id);
  if (!repo) return c.json({ error: 'not found' }, 404);

  // Reuse the list query for derived columns on this one repository.
  const listRows = await listRepositoryItems(c.env.DB, { includeArchived: true });
  const listRow = listRows.find((r) => r.id === id);
  if (!listRow) return c.json({ error: 'not found' }, 404);

  const branches = await listBranches(c.env.DB, id);
  const runs = await listRecentRuns(c.env.DB, id, 10);
  const crs = await listOpenChangeRequests(c.env.DB, id);
  const findings = await listOpenSecurityFindings(c.env.DB, id);
  const healthFindings = await getHealthFindings(c.env.DB, id);

  let topics: string[] = [];
  try {
    topics = repo.topics ? (JSON.parse(repo.topics) as string[]) : [];
  } catch {
    topics = [];
  }

  const body: RepositoryDetailDto = {
    repository: {
      ...rowToListItem(listRow),
      description: repo.description ?? undefined,
      topics,
      licenseSpdx: repo.license_spdx ?? undefined,
      isFork: repo.is_fork === 1,
    },
    healthFindings,
    branches: branches.map((b) => ({
      name: b.name,
      headCommittedAt: b.head_committed_at ?? undefined,
      isDefault: b.is_default === 1,
      isProtected: b.is_protected === 1,
      aheadBy: b.ahead_by ?? undefined,
      behindBy: b.behind_by ?? undefined,
      comparisonStatus: b.comparison_status ?? 'unknown',
      openChangeRequestNumber: b.open_change_request_number ?? undefined,
      excluded: b.excluded === 1,
      excludedReason: b.excluded_reason ?? undefined,
    })),
    pipelineRuns: runs.map((r) => ({
      externalId: r.external_id,
      name: r.name ?? undefined,
      status: r.status ?? 'unknown',
      conclusion: r.conclusion ?? undefined,
      branch: r.branch ?? undefined,
      url: r.url ?? undefined,
      runStartedAt: r.run_started_at ?? undefined,
      durationSeconds: r.duration_seconds ?? undefined,
    })),
    changeRequests: crs.map((cr) => ({
      number: cr.number,
      title: cr.title ?? undefined,
      url: cr.url ?? undefined,
      author: cr.author ?? undefined,
      isDraft: cr.is_draft === 1,
      state: cr.state,
      baseRef: cr.base_ref ?? undefined,
      headRef: cr.head_ref ?? undefined,
      reviewDecision: cr.review_decision ?? undefined,
      mergeableState: cr.mergeable_state ?? undefined,
      checksStatus: cr.checks_status ?? undefined,
      updatedAt: cr.updated_at ?? undefined,
      isStale: cr.is_stale === 1,
    })),
    security:
      findings.length > 0
        ? {
            state: 'available',
            findings: findings.map((f) => ({
              category: f.category,
              severity: f.severity ?? undefined,
              state: f.state ?? undefined,
              summary: f.summary ?? undefined,
              url: f.url ?? undefined,
            })),
          }
        : { state: 'not_configured' },
    budgets: { state: 'not_configured' },
  };
  return c.json(body);
});

apiRoutes.get('/workspaces', async (c) => {
  if (isDemoMode(c.env)) return c.json(demoWorkspaces());
  const workspaces = await listWorkspaceRows(c.env.DB);
  const repoRows = await listRepositoryItems(c.env.DB, { includeArchived: true });
  const body: WorkspaceDto[] = workspaces.map((w) => {
    const repos = repoRows.filter((r) => r.workspace_id === w.id);
    const counts: Record<string, number> = {};
    for (const r of repos) {
      const level = r.attention_level ?? 'unknown';
      counts[level] = (counts[level] ?? 0) + 1;
    }
    return {
      id: w.id,
      provider: 'github',
      slug: w.slug,
      displayName: w.display_name ?? undefined,
      kind: w.kind,
      avatarUrl: w.avatar_url ?? undefined,
      repositoryCount: repos.length,
      attentionCounts: counts,
      lastReconciledAt: w.last_reconciled_at ?? undefined,
    };
  });
  return c.json(body);
});

apiRoutes.get('/platform-health', async (c) => {
  if (isDemoMode(c.env)) return c.json(demoPlatformHealth(APP_VERSION));
  const connections = await listConnections(c.env.DB);
  const sync = await getSyncStats(c.env.DB);
  const webhooks = await getWebhookStats(c.env.DB);
  const body: PlatformHealthDto = {
    demoMode: false,
    connections: connections.map((conn) => ({
      provider: conn.provider_type,
      displayName: conn.display_name,
      status: conn.status,
      lastSuccessAt: conn.last_success_at ?? undefined,
      lastErrorCode: conn.last_error_code ?? undefined,
    })),
    sync: { ...sync },
    webhooks,
    version: APP_VERSION,
    migrationOk: true,
    generatedAt: new Date().toISOString(),
  };
  return c.json(body);
});

apiRoutes.get('/about/credits', (c) => c.json(CREDITS));

apiRoutes.post('/admin/sync', requireAdmin, async (c) => {
  if (isDemoMode(c.env)) return c.json({ ok: true, demo: true });
  const user = c.get('user');
  await enqueueSyncJob(c.env.DB, 'discovery', 'all', 2);
  await recordAuditEvent(c.env.DB, user.login, 'sync.manual', 'discovery enqueued');
  return c.json({ ok: true });
});
