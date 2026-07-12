import type {
  BranchSnapshot,
  ChangeRequestSnapshot,
  PipelineRunSnapshot,
} from '@repo-wrangler/domain';
import {
  capabilityAvailable,
  evaluateRepositoryHealth,
} from '@repo-wrangler/domain';
import {
  claimNextSyncJob,
  checkpointSyncJob,
  completeSyncJob,
  compactChangeRequests,
  compactPipelineRuns,
  compactSyncJobs,
  compactWebhookDeliveries,
  claimEnrichmentBatch,
  ensureGitHubConnection,
  enqueueSyncJob,
  failSyncJob,
  getMeta,
  getRepositoryByFullName,
  listBranches,
  listOpenChangeRequests,
  listOpenSecurityFindings,
  latestDefaultBranchRunRow,
  markEnriched,
  markUnseenInaccessible,
  markWorkspaceReconciled,
  recordConnectionSuccess,
  recordConnectionError,
  setMeta,
  upsertBranch,
  upsertChangeRequest,
  upsertHealthSnapshot,
  upsertPipelineRun,
  upsertRepository,
  upsertWorkspace,
  type RepositoryRow,
} from '@repo-wrangler/persistence-d1';
import {
  collectBranches,
  getInstallationToken,
  latestDefaultBranchRun,
  listInstallationRepositories,
  listInstallations,
  listOpenPullRequests,
  mapInstallationToWorkspace,
} from '@repo-wrangler/provider-github';
import { isDemoMode, type Env } from '../bindings';

/**
 * Checkpointed reconciliation engine. Every invocation claims a bounded
 * amount of work, records a cursor after each unit, and stops before the
 * free-tier subrequest budget is exhausted. It never attempts the whole
 * estate in one execution.
 */

const SUBREQUEST_BUDGET = 40;
const MAX_JOBS_PER_INVOCATION = 3;
const DISCOVERY_INTERVAL_HOURS = 6;
const ENRICH_BATCH_SIZE = 5;

interface DiscoveryCursor {
  installationIndex: number;
  page: number;
  seenExternalIds: string[];
}

export async function runScheduled(env: Env, cron: string): Promise<void> {
  if (isDemoMode(env)) return;

  if (cron === '17 3 * * *') {
    await runDailyMaintenance(env);
    return;
  }

  await ensurePeriodicJobs(env);

  let subrequestsUsed = 0;
  for (let i = 0; i < MAX_JOBS_PER_INVOCATION; i++) {
    if (subrequestsUsed >= SUBREQUEST_BUDGET - 10) break;
    const job = await claimNextSyncJob(env.DB);
    if (!job) break;
    try {
      subrequestsUsed += await runJob(env, job.id, job.job_type, job.scope, job.cursor, SUBREQUEST_BUDGET - subrequestsUsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await failSyncJob(env.DB, job.id, message);
    }
  }
}

/** Keep the estate fresh even if no webhook ever arrives. */
async function ensurePeriodicJobs(env: Env): Promise<void> {
  const lastDiscovery = await getMeta(env.DB, 'last_discovery_enqueued_at');
  const due =
    !lastDiscovery ||
    Date.now() - Date.parse(lastDiscovery) > DISCOVERY_INTERVAL_HOURS * 60 * 60 * 1000;
  if (due) {
    await enqueueSyncJob(env.DB, 'discovery', 'all', 3);
    await setMeta(env.DB, 'last_discovery_enqueued_at', new Date().toISOString());
  }

  // Rolling enrichment of the stalest repositories.
  const stale = await claimEnrichmentBatch(env.DB, ENRICH_BATCH_SIZE);
  for (const repo of stale) {
    await enqueueSyncJob(env.DB, 'enrich_repository', repo.full_name, 5);
  }
}

async function runDailyMaintenance(env: Env): Promise<void> {
  const retentionDays = Number(env.DEFAULT_RETENTION_DAYS ?? '90');
  await compactPipelineRuns(env.DB, retentionDays);
  await compactChangeRequests(env.DB, 180);
  await compactWebhookDeliveries(env.DB, 7);
  await compactSyncJobs(env.DB, 30);
  await enqueueSyncJob(env.DB, 'discovery', 'all', 3);
  // Billing/budget sync lands here in Phase 3 (capability-gated).
}

async function runJob(
  env: Env,
  jobId: string,
  jobType: string,
  scope: string | null,
  cursor: string | null,
  budget: number,
): Promise<number> {
  switch (jobType) {
    case 'discovery':
      return runDiscovery(env, jobId, cursor, budget);
    case 'enrich_repository':
      return runEnrichRepository(env, jobId, scope ?? '');
    case 'evaluate_health': {
      await evaluateHealthForRepo(env, scope ?? '');
      await completeSyncJob(env.DB, jobId, 0);
      return 0;
    }
    default: {
      await completeSyncJob(env.DB, jobId, 0);
      return 0;
    }
  }
}

/**
 * Discovery reconciliation: enumerate installations → workspaces → repository
 * pages, upserting as it goes. After a workspace's complete pass, previously
 * known but unseen repositories are marked inaccessible (tombstone).
 */
async function runDiscovery(
  env: Env,
  jobId: string,
  cursorText: string | null,
  budget: number,
): Promise<number> {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }

  let used = 0;
  const connectionId = await ensureGitHubConnection(env.DB);

  let cursor: DiscoveryCursor = { installationIndex: 0, page: 1, seenExternalIds: [] };
  if (cursorText) {
    try {
      cursor = JSON.parse(cursorText) as DiscoveryCursor;
    } catch {
      // Corrupt cursor — restart the pass; upserts make this safe.
    }
  }

  let installations;
  try {
    installations = await listInstallations(appId, privateKey);
    used += 1;
  } catch (error) {
    await recordConnectionError(env.DB, connectionId, 'installations_list_failed');
    throw error;
  }

  for (let i = cursor.installationIndex; i < installations.length; i++) {
    const installation = installations[i];
    if (!installation) continue;
    const workspaceId = await upsertWorkspace(
      env.DB,
      connectionId,
      mapInstallationToWorkspace(installation),
    );

    const token = await getInstallationToken(appId, privateKey, installation.id);
    used += 1;

    let page = i === cursor.installationIndex ? cursor.page : 1;
    let seen = i === cursor.installationIndex ? [...cursor.seenExternalIds] : [];

    for (;;) {
      if (used >= budget - 5) {
        await checkpointSyncJob(
          env.DB,
          jobId,
          JSON.stringify({ installationIndex: i, page, seenExternalIds: seen } satisfies DiscoveryCursor),
          used,
        );
        return used;
      }
      const result = await listInstallationRepositories(token, page);
      used += 1;
      for (const repo of result.repositories) {
        await upsertRepository(env.DB, workspaceId, repo);
        seen.push(repo.externalId);
      }
      if (result.nextPage === undefined) break;
      page = result.nextPage;
    }

    await markUnseenInaccessible(env.DB, workspaceId, seen);
    await markWorkspaceReconciled(env.DB, workspaceId);
  }

  await recordConnectionSuccess(env.DB, connectionId);
  await completeSyncJob(env.DB, jobId, used);
  return used;
}

/**
 * Repository enrichment: open PRs, latest default-branch run, bounded branch
 * inventory + comparisons, then health evaluation. Priority order per design.
 */
async function runEnrichRepository(env: Env, jobId: string, fullName: string): Promise<number> {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey || !fullName) {
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }

  const repo = await getRepositoryByFullName(env.DB, fullName);
  if (!repo || repo.status !== 'active') {
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }

  const workspace = await env.DB.prepare(
    `SELECT installation_id FROM workspaces WHERE id = ?1`,
  )
    .bind(repo.workspace_id)
    .first<{ installation_id: string | null }>();
  if (!workspace?.installation_id) {
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }

  let used = 0;
  const token = await getInstallationToken(appId, privateKey, workspace.installation_id);
  used += 1;

  const openPrs = await listOpenPullRequests(token, fullName);
  used += 1;
  for (const pr of openPrs) {
    await upsertChangeRequest(env.DB, repo.id, pr);
  }

  const defaultBranch = repo.default_branch ?? 'main';
  const latestRun = await latestDefaultBranchRun(token, fullName, defaultBranch);
  used += 1;
  if (latestRun) {
    await upsertPipelineRun(env.DB, repo.id, latestRun);
  }

  const prHeads = new Set(openPrs.map((pr) => pr.headRef).filter((r): r is string => !!r));
  const branches = await collectBranches(token, fullName, defaultBranch, {
    maxBranches: 100,
    maxComparisons: 5,
    openChangeRequestHeads: prHeads,
  });
  used += 1 + Math.min(5, branches.filter((b) => !b.isDefault && !b.excluded).length);
  for (const branch of branches) {
    const openPr = openPrs.find((pr) => pr.headRef === branch.name && pr.state === 'open');
    await upsertBranch(env.DB, repo.id, {
      ...branch,
      openChangeRequestNumber: openPr?.number,
    });
  }

  await markEnriched(env.DB, repo.id);
  await evaluateHealthForRepo(env, fullName);
  await completeSyncJob(env.DB, jobId, used);
  return used;
}

/** Re-evaluate health from D1 snapshots only (no provider calls). */
export async function evaluateHealthForRepo(env: Env, fullName: string): Promise<void> {
  const repo = await getRepositoryByFullName(env.DB, fullName);
  if (!repo) return;

  const branchRows = await listBranches(env.DB, repo.id);
  const branches: BranchSnapshot[] = branchRows.map((b) => ({
    name: b.name,
    headSha: b.head_sha ?? undefined,
    headCommittedAt: b.head_committed_at ?? undefined,
    isDefault: b.is_default === 1,
    isProtected: b.is_protected === 1,
    aheadBy: b.ahead_by ?? undefined,
    behindBy: b.behind_by ?? undefined,
    comparisonStatus: (b.comparison_status ?? 'unknown') as BranchSnapshot['comparisonStatus'],
    comparedAt: b.compared_at ?? undefined,
    openChangeRequestNumber: b.open_change_request_number ?? undefined,
    excluded: b.excluded === 1,
    excludedReason: b.excluded_reason ?? undefined,
  }));

  const crRows = await listOpenChangeRequests(env.DB, repo.id);
  const changeRequests: ChangeRequestSnapshot[] = crRows.map((cr) => ({
    number: cr.number,
    title: cr.title ?? undefined,
    url: cr.url ?? undefined,
    author: cr.author ?? undefined,
    isDraft: cr.is_draft === 1,
    state: 'open',
    baseRef: cr.base_ref ?? undefined,
    headRef: cr.head_ref ?? undefined,
    reviewDecision: cr.review_decision ?? undefined,
    requestedReviewers: [],
    mergeableState: cr.mergeable_state ?? undefined,
    checksStatus: cr.checks_status ?? undefined,
    createdAt: cr.created_at ?? undefined,
    updatedAt: cr.updated_at ?? undefined,
  }));

  const runRow = repo.default_branch
    ? await latestDefaultBranchRunRow(env.DB, repo.id, repo.default_branch)
    : null;
  const latestRun: PipelineRunSnapshot | undefined = runRow
    ? {
        externalId: runRow.external_id,
        name: runRow.name ?? undefined,
        status: (runRow.status ?? 'unknown') as PipelineRunSnapshot['status'],
        conclusion: (runRow.conclusion ?? undefined) as PipelineRunSnapshot['conclusion'],
        branch: runRow.branch ?? undefined,
        url: runRow.url ?? undefined,
        runStartedAt: runRow.run_started_at ?? undefined,
        durationSeconds: runRow.duration_seconds ?? undefined,
      }
    : undefined;

  const findingRows = await listOpenSecurityFindings(env.DB, repo.id);

  const health = evaluateRepositoryHealth({
    repository: rowToSnapshot(repo),
    branches,
    latestDefaultBranchRun: latestRun,
    openChangeRequests: changeRequests,
    securityFindings: capabilityAvailable(
      findingRows.map((f) => ({
        externalId: f.external_id,
        category: f.category as 'code_scanning' | 'secret_scanning' | 'dependency',
        severity: f.severity ?? undefined,
        state: f.state ?? undefined,
        summary: f.summary ?? undefined,
        url: f.url ?? undefined,
        createdAt: f.created_at ?? undefined,
      })),
    ),
  });

  await upsertHealthSnapshot(env.DB, repo.id, health.level, health.findings, health.policyVersion);
}

function rowToSnapshot(repo: RepositoryRow) {
  return {
    externalId: repo.external_id,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.url ?? undefined,
    description: repo.description ?? undefined,
    visibility: repo.visibility ?? undefined,
    isArchived: repo.is_archived === 1,
    isFork: repo.is_fork === 1,
    isDisabled: false,
    isTemplate: false,
    defaultBranch: repo.default_branch ?? undefined,
    pushedAt: repo.pushed_at ?? undefined,
    primaryLanguage: repo.primary_language ?? undefined,
    topics: safeParseTopics(repo.topics),
    licenseSpdx: repo.license_spdx ?? undefined,
  };
}

function safeParseTopics(topics: string | null): string[] {
  if (!topics) return [];
  try {
    const parsed = JSON.parse(topics);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
