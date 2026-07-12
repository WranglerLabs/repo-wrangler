import type { DomainEvent } from '@repo-wrangler/contracts';
import {
  applyBranchPush,
  enqueueSyncJob,
  getRepositoryByExternalId,
  getWorkspaceByExternalId,
  markBranchDeleted,
  markRepositoryRemoved,
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
export async function applyDomainEvents(db: D1Database, events: DomainEvent[]): Promise<void> {
  for (const event of events) {
    switch (event.type) {
      case 'sync.requested': {
        await enqueueSyncJob(db, event.jobType, event.scope, event.priority);
        break;
      }
      case 'workspace.upsert':
      case 'workspace.removed': {
        // Workspace lifecycle is reconciled by discovery; request one.
        await enqueueSyncJob(db, 'discovery', 'all', 3);
        break;
      }
      case 'repository.upsert': {
        const workspace = await getWorkspaceByExternalId(db, event.ref.workspaceExternalId);
        if (!workspace) {
          await enqueueSyncJob(db, 'discovery', 'all', 3);
          break;
        }
        const repositoryId = await upsertRepository(db, workspace.id, event.repository);
        await enqueueSyncJob(db, 'enrich_repository', event.ref.fullName, 4);
        void repositoryId;
        break;
      }
      case 'repository.removed': {
        const workspace = await getWorkspaceByExternalId(db, event.ref.workspaceExternalId);
        if (!workspace) break;
        await markRepositoryRemoved(db, workspace.id, event.ref.repositoryExternalId);
        break;
      }
      default: {
        // Repository-scoped events share the lookup below.
        const workspace = await getWorkspaceByExternalId(db, event.ref.workspaceExternalId);
        if (!workspace) {
          await enqueueSyncJob(db, 'discovery', 'all', 3);
          break;
        }
        const repository = await getRepositoryByExternalId(
          db,
          workspace.id,
          event.ref.repositoryExternalId,
        );
        if (!repository) {
          await enqueueSyncJob(db, 'discovery', 'all', 3);
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
        await enqueueSyncJob(db, 'evaluate_health', event.ref.fullName, 6);
        break;
      }
    }
  }
}
