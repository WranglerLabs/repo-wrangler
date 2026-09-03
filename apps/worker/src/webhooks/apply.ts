import type { DomainEvent } from '@repo-wrangler/contracts';
import {
  applyBranchPush,
  enqueueSyncJob,
  getRepositoryByExternalId,
  getRepositoryById,
  getRepositoryDiscoveryState,
  getWorkspaceByConnectionAndExternalId,
  getWorkspaceByExternalId,
  markBranchDeleted,
  markRepositoryRemoved,
  markWorkspaceState,
  upsertBranch,
  upsertChangeRequest,
  upsertPipelineRun,
  upsertRepository,
  upsertSecurityFinding,
} from '@repo-wrangler/persistence-d1';

/**
 * Apply compact domain events to D1. Idempotent by construction (upserts and
 * state transitions). Events for repositories not yet discovered enqueue a
 * discovery pass instead of failing.
 */
export async function applyDomainEvents(
  db: D1Database,
  events: DomainEvent[],
  context: { connectionId?: string } = {},
): Promise<void> {
  const findWorkspace = (externalId: string) => context.connectionId
    ? getWorkspaceByConnectionAndExternalId(db, context.connectionId, externalId)
    : getWorkspaceByExternalId(db, externalId);
  for (const event of events) {
    switch (event.type) {
      case 'sync.requested': {
        // Provider webhook parsers from v1 emit repository full names here.
        // The concrete repository event below has stable identity and enqueues
        // the correctly scoped job, so never reintroduce an ambiguous job.
        if (event.jobType === 'enrich_repository' || event.jobType === 'evaluate_health') break;
        await enqueueSyncJob(db, event.jobType,
          event.scope === 'all' && context.connectionId ? context.connectionId : event.scope,
          event.priority);
        break;
      }
      case 'workspace.removed': {
        const workspace = await findWorkspace(event.workspaceExternalId);
        if (workspace) {
          await markWorkspaceState(db, workspace.id, 'removed', 'provider_resource_deleted');
        }
        await enqueueSyncJob(db, 'discovery', context.connectionId ?? 'all', 3);
        break;
      }
      case 'workspace.upsert': {
        // Workspace content is reconciled by discovery; request one.
        await enqueueSyncJob(db, 'discovery', context.connectionId ?? 'all', 3);
        break;
      }
      case 'repository.upsert': {
        const workspace = await findWorkspace(event.ref.workspaceExternalId);
        if (!workspace) {
          await enqueueSyncJob(db, 'discovery', context.connectionId ?? 'all', 3);
          break;
        }
        const repositoryId = await upsertRepository(db, workspace.id, event.repository);
        await enqueueSyncJob(db, 'enrich_repository', repositoryId, 4);
        break;
      }
      case 'repository.removed': {
        const workspace = await findWorkspace(event.ref.workspaceExternalId);
        if (!workspace) break;
        await markRepositoryRemoved(db, workspace.id, event.ref.repositoryExternalId);
        break;
      }
      default: {
        // Repository-scoped events share the lookup below.
        const workspace = await findWorkspace(event.ref.workspaceExternalId);
        const stableRepository = !workspace && context.connectionId
          ? await getRepositoryDiscoveryState(
              db, context.connectionId, event.ref.repositoryExternalId,
            )
          : null;
        if (!workspace && !stableRepository) {
          await enqueueSyncJob(db, 'discovery', context.connectionId ?? 'all', 3);
          break;
        }
        const repository = stableRepository
          ? await getRepositoryById(db, stableRepository.id)
          : await getRepositoryByExternalId(
              db,
              workspace!.id,
              event.ref.repositoryExternalId,
            );
        if (!repository) {
          await enqueueSyncJob(db, 'discovery', context.connectionId ?? 'all', 3);
          break;
        }
        switch (event.type) {
          case 'branch.pushed':
            await applyBranchPush(db, repository.id, event.branchName, event.headSha, event.pushedAt);
            break;
          case 'branch.deleted':
            await markBranchDeleted(db, repository.id, event.branchName);
            break;
          case 'branch.upsert':
            await upsertBranch(db, repository.id, event.branch);
            break;
          case 'pipeline_run.upsert':
            await upsertPipelineRun(db, repository.id, event.run);
            break;
          case 'change_request.upsert':
            await upsertChangeRequest(db, repository.id, event.changeRequest);
            break;
          case 'security_finding.upsert':
            await upsertSecurityFinding(db, repository.id, event.finding);
            break;
        }
        // Snapshot changed — re-evaluate health on the next enrichment pass.
        await enqueueSyncJob(db, 'enrich_repository', repository.id, 5);
        await enqueueSyncJob(db, 'evaluate_health', repository.id, 6);
        break;
      }
    }
  }
}
