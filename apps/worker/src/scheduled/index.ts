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
  beginDiscoveryRun,
  beginOperationRun,
  beginUsageImport,
  claimNextSyncJob,
  checkpointDiscoveryRun,
  checkpointOperationRun,
  checkpointSyncJob,
  completeDiscoveryRun,
  completeOperationRun,
  completeUsageImport,
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
  failCompletedSyncJob,
  failPartialDiscoveryRun,
  failTrackedRuns,
  getAttentionLevel,
  getConnectionById,
  getEnvironmentConnectionByType,
  hasSuccessfulUsageImport,
  getMeta,
  getRepositoryById,
  getRepositoryByFullName,
  getRepositoryDiscoveryState,
  getRepositoryGovernance,
  getWorkspaceMonitoringState,
  getWorkspaceByConnectionAndExternalId,
  listActiveMonitoredRepositories,
  listBranches,
  listActiveConnectionsByType,
  listOpenChangeRequests,
  listOpenSecurityFindings,
  listWorkspacesConfiguredForDiscovery,
  listWorkspacesForSync,
  listWorkspacesForBilling,
  latestDefaultBranchRunRow,
  markEnriched,
  markDiscoveryWorkspaceScanComplete,
  markUnseenInaccessible,
  markUnseenWorkspacesInactive,
  markWorkspaceState,
  markWorkspaceReconciled,
  recordConnectionSuccess,
  recordConnectionError,
  recordConnectionCapability,
  recordConnectionOperation,
  recordDiscoveryRepositorySeen,
  recordDiscoveryWorkspaceSeen,
  prepareDiscoveryRunForReconciliation,
  reconcileDiscoveryRunMissingRepositories,
  setMeta,
  setRepositoryGovernance,
  upsertBranch,
  replaceWorkspaceBudgets,
  setProviderCapability,
  replaceWorkspaceUsagePeriod,
  upsertChangeRequest,
  upsertHealthSnapshot,
  upsertPipelineRun,
  upsertRepository,
  upsertSecurityFinding,
  upsertWorkspace,
  updateConnectionExternalAccountId,
  type RepositoryRow,
} from '@repo-wrangler/persistence-d1';
import {
  collectBranches,
  fetchGovernanceProfile,
  getInstallationToken,
  latestDefaultBranchRun,
  listInstallationRepositories,
  listInstallationsDetailed,
  listOpenPullRequests,
  listOrganizationBudgets,
  listOrganizationUsage,
  listSecurityFindings,
  mapInstallationToWorkspace,
} from '@repo-wrangler/provider-github';
import {
  GitLabClient,
  collectGitLabBranches,
  getGroupWorkspace,
  inspectGitLabToken,
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
// B11: three jobs per tick let discovery enqueue hundreds of repository
// enrichments faster than the scheduler could consume them. Keep the
// subrequest budget as the hard safety boundary, but allow cheap jobs and
// GitLab enrichments to use the remaining invocation capacity.
const MAX_JOBS_PER_INVOCATION = 10;
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
    await enqueueSyncJob(env.DB, 'enrich_repository', repo.id, 5);
  }
}

interface DiscoveryCursor {
  installationIndex: number;
  page: number;
  seenExternalIds: string[];
  seenWorkspaceExternalIds: string[];
  changes: DiscoveryChangeSummary;
}

interface DiscoveryChangeSummary {
  workspacesAdded: number;
  workspacesRenamed: number;
  workspacesInaccessible: number;
  workspacesRemoved: number;
  repositoriesAdded: number;
  repositoriesRenamed: number;
  repositoriesMoved: number;
  repositoriesInaccessible: number;
  repositoriesRemoved: number;
}

interface GitLabDiscoveryCursor {
  groupIndex: number;
  page: number;
  seenExternalIds: string[];
  failures: number;
  changes: DiscoveryChangeSummary;
}

function emptyDiscoveryChanges(): DiscoveryChangeSummary {
  return {
    workspacesAdded: 0, workspacesRenamed: 0, workspacesInaccessible: 0,
    workspacesRemoved: 0, repositoriesAdded: 0, repositoriesRenamed: 0,
    repositoriesMoved: 0, repositoriesInaccessible: 0, repositoriesRemoved: 0,
  };
}

function installationPermissionSummary(
  installations: Array<{ permissions?: Record<string, string> }>,
): { status: string; permissions: Record<string, string> } {
  const permissions: Record<string, string> = {};
  for (const installation of installations) {
    for (const [name, level] of Object.entries(installation.permissions ?? {})) {
      if (level === 'write' || permissions[name] === undefined) permissions[name] = level;
    }
  }
  const hasWrite = Object.values(permissions).some((level) => level === 'write');
  return {
    status: hasWrite ? 'write_scope_detected'
      : Object.keys(permissions).length > 0 ? 'read_only_verified' : 'reachable_permissions_unreported',
    permissions,
  };
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
      await failTrackedRuns(env.DB, job.id, 'provider_operation_failed', message);
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
  for (const connection of await listActiveConnectionsByType(env.DB, 'gitlab')) {
    if (await resolveGitLabCredentials(env, env.DB, connection.id)) return true;
  }
  return false;
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
    await enqueueSyncJob(env.DB, 'enrich_repository', repo.id, 5);
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
      return runDiscovery(env, jobId, cursor, budget, scope ?? 'all');
    case 'gitlab_discovery':
      return runGitLabDiscovery(env, jobId, scope ?? 'all', cursor, budget);
    case 'enrich_repository':
      return runEnrichRepository(env, jobId, scope ?? '');
    case 'billing':
      return runBillingSync(env, jobId, cursor, budget, scope ?? 'all');
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
  connectionScope = 'all',
): Promise<number> {
  // ADR-021: resolves through the `db` secret store first, so a GitHub App
  // connected entirely through the wizard (no GITHUB_APP_ID env var) is
  // discovered exactly like an env-configured one.
  let connectionId: string;
  let credentials = null as Awaited<ReturnType<typeof resolveGitHubAppCredentials>>;
  if (connectionScope === 'all') {
    const connections = await listActiveConnectionsByType(env.DB, 'github');
    if (connections.length > 1) {
      for (const connection of connections) {
        await enqueueSyncJob(env.DB, 'discovery', connection.id, 3);
      }
      await completeSyncJob(env.DB, jobId, 0);
      return 0;
    }
    if (connections[0]) {
      connectionId = connections[0].id;
    } else {
      const existingEnvironmentConnection = await getEnvironmentConnectionByType(env.DB, 'github');
      if (existingEnvironmentConnection && existingEnvironmentConnection.status !== 'active') {
        await completeSyncJob(env.DB, jobId, 0);
        return 0;
      }
      credentials = await resolveGitHubAppCredentials(env, env.DB);
      if (!credentials) {
        await completeSyncJob(env.DB, jobId, 0);
        return 0;
      }
      connectionId = await ensureGitHubConnection(env.DB);
    }
  } else {
    connectionId = connectionScope;
    const connection = await getConnectionById(env.DB, connectionId);
    if (!connection || connection.provider_type !== 'github' || connection.status !== 'active') {
      await completeSyncJob(env.DB, jobId, 0);
      return 0;
    }
  }
  if (!credentials) credentials = await resolveGitHubAppCredentials(env, env.DB, connectionId);
  if (!credentials) {
    await recordConnectionCapability(env.DB, connectionId, 'credentials_missing');
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }
  await beginDiscoveryRun(env.DB, jobId, connectionId);
  const { appId, privateKey } = credentials;
  await updateConnectionExternalAccountId(env.DB, connectionId, appId);

  let used = 0;
  let cursor: DiscoveryCursor = {
    installationIndex: 0,
    page: 1,
    seenExternalIds: [],
    seenWorkspaceExternalIds: [],
    changes: emptyDiscoveryChanges(),
  };
  if (cursorText) {
    try {
      const parsed = JSON.parse(cursorText) as Partial<DiscoveryCursor>;
      cursor = {
        installationIndex: parsed.installationIndex ?? 0,
        page: parsed.page ?? 1,
        seenExternalIds: parsed.seenExternalIds ?? [],
        seenWorkspaceExternalIds: parsed.seenWorkspaceExternalIds ?? [],
        changes: parsed.changes ?? emptyDiscoveryChanges(),
      };
    } catch {
      // Corrupt cursor — restart the pass; upserts make this safe.
    }
  }

  let installations;
  try {
    const result = await listInstallationsDetailed(appId, privateKey, Math.max(1, budget - 5));
    installations = result.installations;
    used += result.subrequestsUsed;
    const permissionSummary = installationPermissionSummary(installations);
    await recordConnectionCapability(
      env.DB, connectionId, permissionSummary.status, permissionSummary.permissions,
    );
  } catch (error) {
    await recordConnectionError(env.DB, connectionId, 'installations_list_failed');
    await recordConnectionCapability(env.DB, connectionId, 'provider_unreachable');
    throw error;
  }

  for (let i = cursor.installationIndex; i < installations.length; i++) {
    const installation = installations[i];
    if (!installation?.account) continue;
    if (!cursor.seenWorkspaceExternalIds.includes(String(installation.account.id))) {
      cursor.seenWorkspaceExternalIds.push(String(installation.account.id));
    }
    const previousWorkspace = await getWorkspaceByConnectionAndExternalId(
      env.DB, connectionId, String(installation.account.id),
    );
    const mappedWorkspace = mapInstallationToWorkspace(installation);
    if (!previousWorkspace) cursor.changes.workspacesAdded += 1;
    else if (previousWorkspace.slug !== mappedWorkspace.slug) cursor.changes.workspacesRenamed += 1;
    const suspended = Boolean(installation.suspended_at);
    const workspaceId = await upsertWorkspace(
      env.DB,
      connectionId,
      mappedWorkspace,
      suspended ? { status: 'inaccessible', reason: 'permission_lost' } : undefined,
    );
    await recordDiscoveryWorkspaceSeen(
      env.DB, jobId, connectionId, String(installation.account.id), workspaceId,
    );

    if (suspended) {
      if (!previousWorkspace || previousWorkspace.status !== 'inaccessible'
        || previousWorkspace.status_reason !== 'permission_lost') {
        cursor.changes.workspacesInaccessible += 1;
      }
      continue;
    }

    // A2: an ignored workspace stays current (the upsert above already ran)
    // but spends zero subrequests paginating repositories no one will see.
    if ((await getWorkspaceMonitoringState(env.DB, workspaceId)) === 'ignored') continue;

    const token = await getInstallationToken(appId, privateKey, installation.id);
    used += 1;

    let page = i === cursor.installationIndex ? cursor.page : 1;
    const seen = i === cursor.installationIndex ? [...cursor.seenExternalIds] : [];

    for (;;) {
      if (used >= budget - 5) {
        const checkpoint = JSON.stringify({
          installationIndex: i,
          page,
          seenExternalIds: seen,
          seenWorkspaceExternalIds: cursor.seenWorkspaceExternalIds,
          changes: cursor.changes,
        } satisfies DiscoveryCursor);
        await checkpointSyncJob(
          env.DB,
          jobId,
          checkpoint,
          used,
        );
        await checkpointDiscoveryRun(env.DB, jobId, checkpoint, used);
        return used;
      }
      const result = await listInstallationRepositories(token, page);
      used += 1;
      for (const repo of result.repositories) {
        const previous = await getRepositoryDiscoveryState(env.DB, connectionId, repo.externalId);
        if (!previous) cursor.changes.repositoriesAdded += 1;
        else {
          if (previous.workspace_id !== workspaceId) cursor.changes.repositoriesMoved += 1;
          if (previous.full_name !== repo.fullName) cursor.changes.repositoriesRenamed += 1;
        }
        await upsertRepository(env.DB, workspaceId, repo);
        await recordDiscoveryRepositorySeen(env.DB, jobId, workspaceId, repo.externalId);
        seen.push(repo.externalId);
      }
      if (result.nextPage === undefined) break;
      page = result.nextPage;
    }

    await markDiscoveryWorkspaceScanComplete(env.DB, jobId, workspaceId);
    await markWorkspaceReconciled(env.DB, workspaceId);
    await enqueueEnrichmentForWorkspace(env, workspaceId);
  }

  await prepareDiscoveryRunForReconciliation(env.DB, jobId);
  cursor.changes.repositoriesInaccessible += await reconcileDiscoveryRunMissingRepositories(
    env.DB, jobId,
  );
  cursor.changes.workspacesInaccessible += await markUnseenWorkspacesInactive(
    env.DB,
    connectionId,
    cursor.seenWorkspaceExternalIds,
    'app_uninstalled_permission_lost_or_provider_deleted_pending_confirmation',
  );
  await recordConnectionOperation(env.DB, connectionId, 'discovery');
  await recordConnectionSuccess(env.DB, connectionId);
  const seenRepositoryCount = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM discovery_run_seen_repositories WHERE run_id = ?1',
  ).bind(jobId).first<{ count: number }>();
  await completeDiscoveryRun(env.DB, jobId, used, {
    ...cursor.changes,
    workspacesSeen: cursor.seenWorkspaceExternalIds.length,
    repositoriesSeen: seenRepositoryCount?.count ?? 0,
    noChange: Object.values(cursor.changes).every((value) => value === 0),
  });
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
export async function runGitLabDiscovery(
  env: Env,
  jobId: string,
  connectionScope = 'all',
  cursorText: string | null = null,
  budget = SUBREQUEST_BUDGET,
): Promise<number> {
  let connectionId: string;
  let credentials = null as Awaited<ReturnType<typeof resolveGitLabCredentials>>;
  if (connectionScope === 'all') {
    const connections = await listActiveConnectionsByType(env.DB, 'gitlab');
    if (connections.length > 1) {
      for (const connection of connections) {
        await enqueueSyncJob(env.DB, 'gitlab_discovery', connection.id, 3);
      }
      await completeSyncJob(env.DB, jobId, 0);
      return 0;
    }
    if (connections[0]) {
      connectionId = connections[0].id;
    } else {
      const environmentBaseUrl = env.GITLAB_BASE_URL ?? 'https://gitlab.com';
      const existingEnvironmentConnection = await getEnvironmentConnectionByType(
        env.DB, 'gitlab', environmentBaseUrl,
      );
      if (existingEnvironmentConnection && existingEnvironmentConnection.status !== 'active') {
        await completeSyncJob(env.DB, jobId, 0);
        return 0;
      }
      credentials = await resolveGitLabCredentials(env, env.DB);
      if (!credentials) {
        await completeSyncJob(env.DB, jobId, 0);
        return 0;
      }
      connectionId = await ensureGitLabConnection(env.DB, credentials.baseUrl);
    }
  } else {
    connectionId = connectionScope;
    const connection = await getConnectionById(env.DB, connectionId);
    if (!connection || connection.provider_type !== 'gitlab' || connection.status !== 'active') {
      await completeSyncJob(env.DB, jobId, 0);
      return 0;
    }
  }
  if (!credentials) credentials = await resolveGitLabCredentials(env, env.DB, connectionId);
  if (!credentials) {
    await recordConnectionCapability(env.DB, connectionId, 'credentials_missing');
    await completeSyncJob(env.DB, jobId, 0);
    return 0;
  }
  await beginDiscoveryRun(env.DB, jobId, connectionId);
  const client = new GitLabClient(credentials.token, credentials.baseUrl);
  const tokenCapability = await inspectGitLabToken(client);
  const persistedWorkspaces = await listWorkspacesConfiguredForDiscovery(env.DB, connectionId);
  const groups: Array<{
    lookup: string;
    existingId?: string;
    existingStatus?: string;
    existingStatusReason?: string | null;
  }> =
    persistedWorkspaces.length > 0
      ? persistedWorkspaces.map((w) => ({
          lookup: w.external_id,
          existingId: w.id,
          existingStatus: w.status,
          existingStatusReason: w.status_reason,
        }))
      : (env.GITLAB_GROUPS ?? '')
          .split(',')
          .map((group) => group.trim())
          .filter(Boolean)
          .map((lookup) => ({ lookup }));

  let cursor: GitLabDiscoveryCursor = {
    groupIndex: 0,
    page: 1,
    seenExternalIds: [],
    failures: 0,
    changes: emptyDiscoveryChanges(),
  };
  if (cursorText) {
    try {
      const parsed = JSON.parse(cursorText) as Partial<GitLabDiscoveryCursor>;
      cursor = {
        groupIndex: parsed.groupIndex ?? 0,
        page: parsed.page ?? 1,
        seenExternalIds: parsed.seenExternalIds ?? [],
        failures: parsed.failures ?? 0,
        changes: parsed.changes ?? emptyDiscoveryChanges(),
      };
    } catch {
      // Invalid checkpoint: restart safely; no missing state has been applied.
    }
  }
  let used = 1;
  for (let groupIndex = cursor.groupIndex; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    if (!group) continue;
    let discoveredWorkspaceId: string | undefined;
    try {
      if (used >= budget - 3) {
        const checkpoint = JSON.stringify({ ...cursor, groupIndex } satisfies GitLabDiscoveryCursor);
        await checkpointSyncJob(env.DB, jobId, checkpoint, used);
        await checkpointDiscoveryRun(env.DB, jobId, checkpoint, used);
        return used;
      }
      const workspace = await getGroupWorkspace(client, group.lookup);
      used += 1;
      const previousWorkspace = await getWorkspaceByConnectionAndExternalId(
        env.DB, connectionId, workspace.externalId,
      );
      if (!previousWorkspace) cursor.changes.workspacesAdded += 1;
      else if (previousWorkspace.slug !== workspace.slug) cursor.changes.workspacesRenamed += 1;
      const workspaceId = await upsertWorkspace(env.DB, connectionId, workspace);
      discoveredWorkspaceId = workspaceId;
      await recordDiscoveryWorkspaceSeen(
        env.DB, jobId, connectionId, workspace.externalId, workspaceId,
      );

      // A2: same shape as the GitHub loop above — the group stays current
      // but its projects are not paginated while ignored.
      if ((await getWorkspaceMonitoringState(env.DB, workspaceId)) === 'ignored') {
        cursor.page = 1;
        cursor.seenExternalIds = [];
        continue;
      }

      const seen = groupIndex === cursor.groupIndex ? [...cursor.seenExternalIds] : [];
      let page: number | undefined = groupIndex === cursor.groupIndex ? cursor.page : 1;
      while (page !== undefined) {
        if (used >= budget - 2) {
          const checkpoint = JSON.stringify({
            ...cursor, groupIndex, page, seenExternalIds: seen,
          } satisfies GitLabDiscoveryCursor);
          await checkpointSyncJob(env.DB, jobId, checkpoint, used);
          await checkpointDiscoveryRun(env.DB, jobId, checkpoint, used);
          return used;
        }
        const result = await listGroupProjects(client, workspace.externalId, page);
        used += 1;
        for (const repo of result.repositories) {
          const previous = await getRepositoryDiscoveryState(env.DB, connectionId, repo.externalId);
          if (!previous) cursor.changes.repositoriesAdded += 1;
          else {
            if (previous.workspace_id !== workspaceId) cursor.changes.repositoriesMoved += 1;
            if (previous.full_name !== repo.fullName) cursor.changes.repositoriesRenamed += 1;
          }
          await upsertRepository(env.DB, workspaceId, repo);
          await recordDiscoveryRepositorySeen(env.DB, jobId, workspaceId, repo.externalId);
          seen.push(repo.externalId);
        }
        page = result.nextPage;
      }
      await markDiscoveryWorkspaceScanComplete(env.DB, jobId, workspaceId);
      await markWorkspaceReconciled(env.DB, workspaceId);
      await enqueueEnrichmentForWorkspace(env, workspaceId);
      cursor.page = 1;
      cursor.seenExternalIds = [];
    } catch (error) {
      cursor.failures += 1;
      used += 1;
      const affectedWorkspaceId = discoveredWorkspaceId ?? group.existingId;
      if (affectedWorkspaceId) {
        const message = error instanceof Error ? error.message : '';
        if (discoveredWorkspaceId) {
          // The group lookup succeeded. A later project-page failure cannot
          // prove any resource disappeared, so preserve the active state.
          await markWorkspaceState(
            env.DB, affectedWorkspaceId, 'active', 'repository_discovery_failed_pending_confirmation',
          );
        } else {
          const status = message.includes('HTTP 404') ? 'removed' : 'inaccessible';
          const reason = message.includes('HTTP 404')
            ? 'provider_resource_deleted'
            : message.includes('HTTP 401') || message.includes('HTTP 403')
              ? 'permission_lost'
              : 'discovery_failed_pending_confirmation';
          const changed = group.existingStatus !== status
            || group.existingStatusReason !== reason;
          if (changed && status === 'removed') cursor.changes.workspacesRemoved += 1;
          else if (changed) cursor.changes.workspacesInaccessible += 1;
          await markWorkspaceState(env.DB, affectedWorkspaceId, status, reason);
        }
      }
    }
  }
  // A failed group must not prevent independently completed groups from
  // reconciling. The seen-workspace table gates this to scopes whose complete
  // repository pagination was explicitly recorded; failed/interrupted scopes
  // are never considered for missing-resource transitions.
  await prepareDiscoveryRunForReconciliation(env.DB, jobId);
  cursor.changes.repositoriesInaccessible += await reconcileDiscoveryRunMissingRepositories(env.DB, jobId);
  if (cursor.failures === 0) {
    await recordConnectionOperation(env.DB, connectionId, 'discovery');
    await recordConnectionSuccess(env.DB, connectionId);
    await recordConnectionCapability(
      env.DB, connectionId, tokenCapability.status, tokenCapability.details,
    );
  } else {
    await recordConnectionError(env.DB, connectionId, 'gitlab_discovery_failed');
    await recordConnectionCapability(env.DB, connectionId, 'partial_discovery_failure', {
      ...tokenCapability.details,
      tokenCapability: tokenCapability.status,
      discovery: 'partial_failure',
    });
  }

  const summary = {
    ...cursor.changes,
    groupsAttempted: groups.length,
    groupsCompleted: groups.length - cursor.failures,
    groupsFailed: cursor.failures,
    partial: cursor.failures > 0,
    noChange: cursor.failures === 0
      && Object.values(cursor.changes).every((value) => value === 0),
  };
  if (cursor.failures > 0) {
    const detail = `${cursor.failures} of ${groups.length} GitLab groups failed discovery.`;
    await failPartialDiscoveryRun(env.DB, jobId, used, summary, detail);
    await failCompletedSyncJob(env.DB, jobId, used, detail);
  } else {
    await completeDiscoveryRun(env.DB, jobId, used, summary);
    await completeSyncJob(env.DB, jobId, used);
  }
  return used;
}

interface RepoContext {
  repo: RepositoryRow;
  provider: string;
  installationId: string | null;
  connectionId: string;
}

async function getRepoContext(env: Env, repositoryScope: string): Promise<RepoContext | null> {
  // New jobs use the stable internal id. The full-name fallback drains jobs
  // that may already be pending during a rolling upgrade from v1.0.18.
  const repo = await getRepositoryById(env.DB, repositoryScope)
    ?? await getRepositoryByFullName(env.DB, repositoryScope);
  if (!repo || repo.status !== 'active') return null;
  const row = await env.DB.prepare(
    `SELECT w.installation_id, c.provider_type, c.id AS connection_id
     FROM workspaces w JOIN provider_connections c ON c.id = w.connection_id
     WHERE w.id = ?1 AND w.status = 'active' AND w.monitoring_state = 'monitored'
       AND c.status = 'active'`,
  )
    .bind(repo.workspace_id)
    .first<{ installation_id: string | null; provider_type: string; connection_id: string }>();
  if (!row) return null;
  return {
    repo,
    provider: row.provider_type,
    installationId: row.installation_id,
    connectionId: row.connection_id,
  };
}

/** Repository enrichment, dispatched by provider. */
async function runEnrichRepository(env: Env, jobId: string, repositoryScope: string): Promise<number> {
  const context = await getRepoContext(env, repositoryScope);
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
  const credentials = await resolveGitHubAppCredentials(env, env.DB, context.connectionId);
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
  await evaluateHealthForRepo(env, repo.id);
  return used;
}

async function enrichGitLabRepository(env: Env, context: RepoContext): Promise<number> {
  const credentials = await resolveGitLabCredentials(env, env.DB, context.connectionId);
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

interface BillingCursor {
  workspaceIndex: number;
  monthOffset: number;
  budgetsCompleted: boolean;
}

function billingPeriod(monthOffset: number) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 1));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return {
    year,
    month,
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

function parseBillingCursor(cursorText: string | null): BillingCursor {
  if (!cursorText) return { workspaceIndex: 0, monthOffset: 0, budgetsCompleted: false };
  try {
    const parsed = JSON.parse(cursorText) as Partial<BillingCursor>;
    return {
      workspaceIndex: parsed.workspaceIndex ?? 0,
      monthOffset: parsed.monthOffset ?? 0,
      budgetsCompleted: parsed.budgetsCompleted ?? false,
    };
  } catch {
    const legacyIndex = Number.parseInt(cursorText, 10);
    return {
      workspaceIndex: Number.isFinite(legacyIndex) ? legacyIndex : 0,
      monthOffset: 0,
      budgetsCompleted: false,
    };
  }
}

/** Daily budget refresh plus a checkpointed 24-month usage backfill. */
export async function runBillingSync(
  env: Env,
  jobId: string,
  cursorText: string | null,
  budget: number,
  connectionScope = 'all',
): Promise<number> {
  await beginOperationRun(env.DB, {
    id: jobId,
    jobId,
    type: 'billing',
    connectionId: connectionScope === 'all' ? undefined : connectionScope,
  });
  let used = 0;
  let monthsImported = 0;
  const workspaces = (await listWorkspacesForBilling(env.DB)).filter((workspace) =>
    connectionScope === 'all' || workspace.connection_id === connectionScope);
  const cursor = parseBillingCursor(cursorText);
  for (let index = cursor.workspaceIndex; index < workspaces.length; index += 1) {
    const workspace = workspaces[index];
    if (!workspace) continue;
    if (!workspace.installation_id || workspace.kind === 'user') continue;
    if (used > 0 && budget - used < 5) {
      const checkpoint = JSON.stringify({
        workspaceIndex: index,
        monthOffset: index === cursor.workspaceIndex ? cursor.monthOffset : 0,
        budgetsCompleted: index === cursor.workspaceIndex ? cursor.budgetsCompleted : false,
      } satisfies BillingCursor);
      await checkpointSyncJob(env.DB, jobId, checkpoint, used);
      await checkpointOperationRun(env.DB, jobId, checkpoint, used);
      return used;
    }
    const credentials = await resolveGitHubAppCredentials(env, env.DB, workspace.connection_id);
    if (!credentials) {
      await setProviderCapability(env.DB, workspace.id, 'budgets', 'not_configured', 'credentials_missing');
      await setProviderCapability(env.DB, workspace.id, 'usage', 'not_configured', 'credentials_missing');
      continue;
    }
    const { appId, privateKey } = credentials;
    const token = await getInstallationToken(appId, privateKey, workspace.installation_id);
    used += 1;

    let budgetsCompleted = index === cursor.workspaceIndex ? cursor.budgetsCompleted : false;
    if (!budgetsCompleted) {
      const budgetAllowance = Math.max(1, budget - used - 3);
      const budgets = await listOrganizationBudgets(token, workspace.slug, budgetAllowance);
      used += budgets.data?.subrequestsUsed ?? 1;
      if (budgets.state === 'available') {
        await replaceWorkspaceBudgets(env.DB, workspace.id, budgets.data?.items ?? []);
      }
      await setProviderCapability(env.DB, workspace.id, 'budgets', budgets.state,
        budgets.state === 'available' ? undefined : budgets.state, budgets.detail);
      await setMeta(env.DB, `budgets_capability:${workspace.id}`, budgets.state);
      budgetsCompleted = true;
    }

    const firstMonthOffset = index === cursor.workspaceIndex ? cursor.monthOffset : 0;
    for (let monthOffset = firstMonthOffset; monthOffset < 24; monthOffset += 1) {
      const period = billingPeriod(monthOffset);
      if (monthOffset > 0 && await hasSuccessfulUsageImport(
        env.DB, workspace.id, period.start, period.end,
      )) continue;
      if (budget - used < 3) {
        const checkpoint = JSON.stringify({
          workspaceIndex: index, monthOffset, budgetsCompleted,
        } satisfies BillingCursor);
        await checkpointSyncJob(env.DB, jobId, checkpoint, used);
        await checkpointOperationRun(env.DB, jobId, checkpoint, used);
        return used;
      }
      const usageImportId = `${jobId}:${workspace.id}:${period.start}`;
      await beginUsageImport(env.DB, {
        id: usageImportId, jobId, connectionId: workspace.connection_id,
        workspaceId: workspace.id, periodStart: period.start, periodEnd: period.end,
      });
      const usage = await listOrganizationUsage(token, workspace.slug,
        { year: period.year, month: period.month }, Math.max(1, budget - used));
      used += usage.data?.subrequestsUsed ?? 3;
      if (usage.state === 'available') {
        await replaceWorkspaceUsagePeriod(
          env.DB, workspace.id, period.start, period.end,
          usage.data?.items ?? [], usageImportId,
        );
        monthsImported += 1;
      }
      await completeUsageImport(env.DB, usageImportId,
        usage.state === 'available' ? 'completed' : 'failed',
        usage.data?.items.length ?? 0, usage.data?.subrequestsUsed ?? 3,
        usage.state === 'available' ? undefined : usage.state, usage.detail);
      if (monthOffset === 0) {
        await setProviderCapability(env.DB, workspace.id, 'usage', usage.state,
          usage.state === 'available' ? undefined : usage.state, usage.detail);
      }
    }
    await recordConnectionOperation(env.DB, workspace.connection_id, 'billing');
    await recordConnectionSuccess(env.DB, workspace.connection_id);
  }
  await completeOperationRun(env.DB, jobId, used, {
    workspacesProcessed: workspaces.length,
    usageMonthsImported: monthsImported,
  });
  await completeSyncJob(env.DB, jobId, used);
  return used;
}

/** Re-evaluate health from D1 snapshots; notify on escalation (Phase 5). */
export async function evaluateHealthForRepo(env: Env, repositoryScope: string): Promise<void> {
  const repo = await getRepositoryById(env.DB, repositoryScope)
    ?? await getRepositoryByFullName(env.DB, repositoryScope);
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
