import type {
  BranchSnapshot,
  ChangeRequestSnapshot,
  GovernanceInfo,
  PipelineRunSnapshot,
  CapabilityResult,
} from '@repo-wrangler/domain';
import {
  capabilityAvailable,
  capabilityUnavailable,
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
  ensureGitLabConnection,
  enqueueSyncJob,
  failSyncJob,
  getAttentionLevel,
  getMeta,
  getRepositoryByFullName,
  getRepositoryGovernance,
  getWorkspaceMonitoringState,
  listActiveMonitoredRepositories,
  listBranches,
  listOpenChangeRequests,
  listOpenSecurityFindings,
  listWorkspacesForConnection,
  listWorkspacesForSync,
  latestDefaultBranchRunRow,
  markEnriched,
  markUnseenInaccessible,
  markWorkspaceReconciled,
  recordConnectionSuccess,
  recordConnectionError,
  setMeta,
  setRepositoryGovernance,
  upsertBranch,
  upsertBudget,
  upsertChangeRequest,
  upsertHealthSnapshot,
  upsertPipelineRun,
  upsertRepository,
  upsertSecurityFinding,
  upsertWorkspace,
  type RepositoryRow,
} from '@repo-wrangler/persistence-d1';
import {
  collectBranches,
  fetchGovernanceProfile,
  getInstallationToken,
  latestDefaultBranchRun,
  listInstallationRepositories,
  listInstallations,
  listOpenPullRequests,
  listOrganizationBudgets,
  listSecurityFindings,
  mapInstallationToWorkspace,
} from '@repo-wrangler/provider-github';
import {
  GitLabClient,
  collectGitLabBranches,
  getGroupWorkspace,
  latestDefaultBranchPipeline,
  listGroupProjects,
  listOpenMergeRequests,
} from '@repo-wrangler/provider-gitlab';
import { isDemoMode, isGitLabConfigured, type Env } from '../bindings';
import { resolveGitHubAppCredentials, resolveGitLabCredentials } from '../lib/connection-secrets';

/**
 * Checkpointed reconciliation engine. Every invocation claims a bounded
 * amount of work, records a cursor after each unit, and stops before the
 * free-tier subrequest budget is exhausted.
 */

const SUBREQUEST_BUDGET = 40;
const MAX_JOBS_PER_INVOCATION = 3;
const DISCOVERY_INTERVAL_HOURS = 6;
const BILLING_INTERVAL_HOURS = 24;
const ENRICH_BATCH_SIZE = 5;

/**
 * B3b: chain enrichment onto discovery. Per-repo detail (branches, pipeline
 * runs, change requests) is written only by `enrich_repository` jobs, and
 * discovery itself never used to enqueue any — only the periodic scheduler
 * tick (`ensurePeriodicJobs`, a globally-bounded sample) or an inbound
 * webhook did. A fresh instance, an admin-triggered sync, or a wizard
 * connect could discover repos that then sat with empty detail forever.
 * `enqueueSyncJob`'s own pending-job dedupe means re-running discovery for
 * the same workspace never double-queues.
 */
async function enqueueEnrichmentForWorkspace(env: Env, workspaceId: string): Promise<void> {
  const repos = await listActiveMonitoredRepositories(env.DB, workspaceId);
  for (const repo of repos) {
    await enqueueSyncJob(env.DB, 'enrich_repository', repo.full_name, 5);
  }
}

interface DiscoveryCursor {
  installationIndex: number;
  page: number;
  seenExternalIds: string[];
}

export async function runScheduled(env: Env, cron: string): Promise<void> {
  if (isDemoMode(env) && !isGitLabConfigured(env)) return;

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
      subrequestsUsed += await runJob(
        env,
        job.id,
        job.job_type,
        job.scope,
        job.cursor,
        SUBREQUEST_BUDGET - subrequestsUsed,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await failSyncJob(env.DB, job.id, message);
    }
  }
}

/**
 * Env-configured *or* wizard-connected (B4): the periodic passes must not
 * gate solely on `GITLAB_GROUPS`/env vars once a connection can live entirely
 * in the `db` secret store.
 */
async function isGitLabConfiguredEffective(env: Env): Promise<boolean> {
  if (isGitLabConfigured(env)) return true;
  return (await resolveGitLabCredentials(env, env.DB)) !== null;
}

/**
 * Keep the estate fresh even if no webhook ever arrives. Exported for direct
 * testing (B12 billing-enqueue tests) — it only enqueues, never claims/runs a
 * job, so testing it directly avoids the same-tick job-draining hazard noted
 * on `runDiscovery`/`runGitLabDiscovery` above.
 */
export async function ensurePeriodicJobs(env: Env): Promise<void> {
  const lastDiscovery = await getMeta(env.DB, 'last_discovery_enqueued_at');
  const due =
    !lastDiscovery ||
    Date.now() - Date.parse(lastDiscovery) > DISCOVERY_INTERVAL_HOURS * 60 * 60 * 1000;
  if (due) {
    if (!isDemoMode(env)) await enqueueSyncJob(env.DB, 'discovery', 'all', 3);
    if (await isGitLabConfiguredEffective(env)) await enqueueSyncJob(env.DB, 'gitlab_discovery', 'all', 3);
    await setMeta(env.DB, 'last_discovery_enqueued_at', new Date().toISOString());
  }

  // B12: billing used to be enqueued only by runDailyMaintenance, which only
  // fires on the literal '17 3 * * *' cron tick — an instance that isn't
  // alive across 03:17 UTC never ran it. Mirror the discovery gate above so
  // billing also runs roughly daily off the ordinary periodic tick,
  // regardless of whether the process is ever up at that exact minute.
  const lastBilling = await getMeta(env.DB, 'last_billing_enqueued_at');
  const billingDue =
    !lastBilling ||
    Date.now() - Date.parse(lastBilling) > BILLING_INTERVAL_HOURS * 60 * 60 * 1000;
  if (billingDue) {
    if (!isDemoMode(env)) await enqueueSyncJob(env.DB, 'billing', 'all', 8);
    await setMeta(env.DB, 'last_billing_enqueued_at', new Date().toISOString());
  }

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
  if (!isDemoMode(env)) {
    await enqueueSyncJob(env.DB, 'discovery', 'all', 3);
    await enqueueSyncJob(env.DB, 'billing', 'all', 8);
  }
  if (await isGitLabConfiguredEffective(env)) await enqueueSyncJob(env.DB, 'gitlab_discovery', 'all', 3);
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
    case 'gitlab_discovery':
      return runGitLabDiscovery(env, jobId);
    case 'enrich_repository':
      return runEnrichRepository(env, jobId, scope ?? '');
    case 'billing':
      return runBillingSync(env, jobId);
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
 * GitHub discovery reconciliation (installations → workspaces → repo pages).
 * Exported for direct testing (B3b enrichment-chaining tests) so the
 * discovery pass can be exercised without also draining the shared
 * `sync_jobs` queue via `runScheduled` — the newly-enqueued
 * `enrich_repository` jobs would otherwise be claimed in the same tick and
 * hit real (unmocked) provider network calls.
 */
export async function runDiscovery(
  env: Env,
  jobId: string,
  cursorText: string | null,
  budget: number,
): Promise<number> {
  // ADR-021: resolves through the `db` secret store first, so a GitHub App
  // connected entirely through the wizard (no GITHUB_APP_ID env var) is
  // discovered exactly like an env-configured one.
  const credentials = await resolveGitHubAppCredentials(env, env.DB);
  if (!credentials) {
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }
  const { appId, privateKey } = credentials;

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

    // A2: an ignored workspace stays current (the upsert above already ran)
    // but spends zero subrequests paginating repositories no one will see.
    if ((await getWorkspaceMonitoringState(env.DB, workspaceId)) === 'ignored') continue;

    const token = await getInstallationToken(appId, privateKey, installation.id);
    used += 1;

    let page = i === cursor.installationIndex ? cursor.page : 1;
    const seen = i === cursor.installationIndex ? [...cursor.seenExternalIds] : [];

    for (;;) {
      if (used >= budget - 5) {
        await checkpointSyncJob(
          env.DB,
          jobId,
          JSON.stringify({
            installationIndex: i,
            page,
            seenExternalIds: seen,
          } satisfies DiscoveryCursor),
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
    await enqueueEnrichmentForWorkspace(env, workspaceId);
  }

  await recordConnectionSuccess(env.DB, connectionId);
  await completeSyncJob(env.DB, jobId, used);
  return used;
}

/**
 * GitLab discovery: configured top-level groups → projects (incl. subgroups).
 * B4 — the group list is the connection's persisted `workspaces` rows (the
 * ones the wizard's `POST /connections/:id/workspaces` created) when any
 * exist; otherwise it falls back to `GITLAB_GROUPS`, so a GitOps operator who
 * prefers the env var keeps working unchanged.
 */
export async function runGitLabDiscovery(env: Env, jobId: string): Promise<number> {
  const credentials = await resolveGitLabCredentials(env, env.DB);
  if (!credentials) {
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }
  const client = new GitLabClient(credentials.token, credentials.baseUrl);
  const connectionId = await ensureGitLabConnection(env.DB, credentials.baseUrl);

  const persistedWorkspaces = await listWorkspacesForConnection(env.DB, connectionId);
  const groups =
    persistedWorkspaces.length > 0
      ? persistedWorkspaces.map((w) => w.slug)
      : (env.GITLAB_GROUPS ?? '')
          .split(',')
          .map((group) => group.trim())
          .filter(Boolean);

  let used = 0;
  try {
    for (const groupPath of groups) {
      const workspace = await getGroupWorkspace(client, groupPath);
      used += 1;
      const workspaceId = await upsertWorkspace(env.DB, connectionId, workspace);

      // A2: same shape as the GitHub loop above — the group stays current
      // but its projects are not paginated while ignored.
      if ((await getWorkspaceMonitoringState(env.DB, workspaceId)) === 'ignored') continue;

      const seen: string[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        const result = await listGroupProjects(client, groupPath, page);
        used += 1;
        for (const repo of result.repositories) {
          await upsertRepository(env.DB, workspaceId, repo);
          seen.push(repo.externalId);
        }
        page = result.nextPage;
      }
      await markUnseenInaccessible(env.DB, workspaceId, seen);
      await markWorkspaceReconciled(env.DB, workspaceId);
      await enqueueEnrichmentForWorkspace(env, workspaceId);
    }
    await recordConnectionSuccess(env.DB, connectionId);
  } catch (error) {
    await recordConnectionError(env.DB, connectionId, 'gitlab_discovery_failed');
    throw error;
  }

  await completeSyncJob(env.DB, jobId, used);
  return used;
}

interface RepoContext {
  repo: RepositoryRow;
  provider: string;
  installationId: string | null;
}

async function getRepoContext(env: Env, fullName: string): Promise<RepoContext | null> {
  const repo = await getRepositoryByFullName(env.DB, fullName);
  if (!repo || repo.status !== 'active') return null;
  const row = await env.DB.prepare(
    `SELECT w.installation_id, c.provider_type
     FROM workspaces w JOIN provider_connections c ON c.id = w.connection_id
     WHERE w.id = ?1`,
  )
    .bind(repo.workspace_id)
    .first<{ installation_id: string | null; provider_type: string }>();
  if (!row) return null;
  return { repo, provider: row.provider_type, installationId: row.installation_id };
}

/** Repository enrichment, dispatched by provider. */
async function runEnrichRepository(env: Env, jobId: string, fullName: string): Promise<number> {
  const context = await getRepoContext(env, fullName);
  if (!context) {
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }
  const used =
    context.provider === 'gitlab'
      ? await enrichGitLabRepository(env, context)
      : await enrichGitHubRepository(env, context);
  await completeSyncJob(env.DB, jobId, used);
  return used;
}

async function enrichGitHubRepository(env: Env, context: RepoContext): Promise<number> {
  const credentials = await resolveGitHubAppCredentials(env, env.DB);
  const { repo } = context;
  if (!credentials || !context.installationId) return 0;
  const { appId, privateKey } = credentials;

  let used = 0;
  const token = await getInstallationToken(appId, privateKey, context.installationId);
  used += 1;

  const openPrs = await listOpenPullRequests(token, repo.full_name);
  used += 1;
  for (const pr of openPrs) {
    await upsertChangeRequest(env.DB, repo.id, pr);
  }

  const defaultBranch = repo.default_branch ?? 'main';
  const latestRun = await latestDefaultBranchRun(token, repo.full_name, defaultBranch);
  used += 1;
  if (latestRun) await upsertPipelineRun(env.DB, repo.id, latestRun);

  const prHeads = new Set(
    openPrs.map((pr) => pr.headRef).filter((ref): ref is string => !!ref),
  );
  const branches = await collectBranches(token, repo.full_name, defaultBranch, {
    maxBranches: 100,
    maxComparisons: 5,
    openChangeRequestHeads: prHeads,
  });
  used += 1 + Math.min(5, branches.filter((b) => !b.isDefault && !b.excluded).length);
  for (const branch of branches) {
    const openPr = openPrs.find((pr) => pr.headRef === branch.name && pr.state === 'open');
    await upsertBranch(env.DB, repo.id, { ...branch, openChangeRequestNumber: openPr?.number });
  }

  // Governance (Phase 3): default-branch protection comes from branch data.
  const defaultBranchRow = branches.find((branch) => branch.isDefault);
  const governance = await fetchGovernanceProfile(
    token,
    repo.full_name,
    defaultBranchRow?.isProtected,
  );
  used += 1;
  await setRepositoryGovernance(env.DB, repo.id, JSON.stringify(governance));

  // Security reconciliation (Phase 3): capability-gated, 3 subrequests.
  const security = await listSecurityFindings(token, repo.full_name);
  used += 3;
  if (security.state === 'available') {
    for (const finding of security.data ?? []) {
      await upsertSecurityFinding(env.DB, repo.id, finding);
    }
  }

  await markEnriched(env.DB, repo.id);
  await evaluateHealthForRepo(env, repo.full_name);
  return used;
}

async function enrichGitLabRepository(env: Env, context: RepoContext): Promise<number> {
  const credentials = await resolveGitLabCredentials(env, env.DB);
  if (!credentials) return 0;
  const { repo } = context;
  const client = new GitLabClient(credentials.token, credentials.baseUrl);
  let used = 0;

  const openMrs = await listOpenMergeRequests(client, repo.external_id);
  used += 1;
  for (const mr of openMrs) {
    await upsertChangeRequest(env.DB, repo.id, mr);
  }

  const defaultBranch = repo.default_branch ?? 'main';
  const pipeline = await latestDefaultBranchPipeline(client, repo.external_id, defaultBranch);
  used += 1;
  if (pipeline) await upsertPipelineRun(env.DB, repo.id, pipeline);

  const mrHeads = new Set(openMrs.map((mr) => mr.headRef).filter((ref): ref is string => !!ref));
  const branches = await collectGitLabBranches(client, repo.external_id, defaultBranch, {
    maxComparisons: 3,
    openChangeRequestHeads: mrHeads,
  });
  used += 1 + 2 * Math.min(3, branches.filter((b) => !b.isDefault && !b.excluded).length);
  for (const branch of branches) {
    const openMr = openMrs.find((mr) => mr.headRef === branch.name);
    await upsertBranch(env.DB, repo.id, { ...branch, openChangeRequestNumber: openMr?.number });
  }

  const defaultBranchRow = branches.find((branch) => branch.isDefault);
  await setRepositoryGovernance(
    env.DB,
    repo.id,
    JSON.stringify(capabilityAvailable({ defaultBranchProtected: defaultBranchRow?.isProtected })),
  );

  await markEnriched(env.DB, repo.id);
  await evaluateHealthForRepo(env, repo.full_name);
  return used;
}

/** Daily budgets sync per GitHub workspace (capability-gated). */
async function runBillingSync(env: Env, jobId: string): Promise<number> {
  const credentials = await resolveGitHubAppCredentials(env, env.DB);
  if (!credentials) {
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }
  const { appId, privateKey } = credentials;
  let used = 0;
  const workspaces = await listWorkspacesForSync(env.DB);
  for (const workspace of workspaces) {
    if (!workspace.installation_id || workspace.kind === 'user') continue;
    const token = await getInstallationToken(appId, privateKey, workspace.installation_id);
    used += 1;
    const budgets = await listOrganizationBudgets(token, workspace.slug);
    used += 1;
    if (budgets.state === 'available') {
      for (const budget of budgets.data ?? []) {
        await upsertBudget(env.DB, workspace.id, budget);
      }
    }
    await setMeta(env.DB, `budgets_capability:${workspace.id}`, budgets.state);
  }
  await completeSyncJob(env.DB, jobId, used);
  return used;
}

/** Re-evaluate health from D1 snapshots; notify on escalation (Phase 5). */
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

  let governance: CapabilityResult<GovernanceInfo> = capabilityUnavailable('not_configured');
  const governanceJson = await getRepositoryGovernance(env.DB, repo.id);
  if (governanceJson) {
    try {
      governance = JSON.parse(governanceJson) as CapabilityResult<GovernanceInfo>;
    } catch {
      // Keep not_configured on parse failure.
    }
  }

  const previousLevel = await getAttentionLevel(env.DB, repo.id);

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
    governance,
  });

  await upsertHealthSnapshot(env.DB, repo.id, health.level, health.findings, health.policyVersion);

  // Phase 5: outbound notification when a repository escalates to high/critical.
  const escalated =
    (health.level === 'critical' || health.level === 'high') && previousLevel !== health.level;
  if (escalated && env.NOTIFY_WEBHOOK_URL) {
    try {
      await fetch(env.NOTIFY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'repo-wrangler',
          repository: repo.full_name,
          url: repo.url,
          previousLevel: previousLevel ?? 'unknown',
          level: health.level,
          findings: health.findings.filter((finding) => finding.severity !== 'info'),
          observedAt: new Date().toISOString(),
        }),
      });
    } catch {
      // Notification failure never blocks health evaluation.
    }
  }
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
