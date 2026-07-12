import type {
  BranchSnapshot,
  ChangeRequestSnapshot,
  PipelineRunSnapshot,
  RepositorySnapshot,
  SecurityFindingSnapshot,
  WorkspaceSnapshot,
} from '@repo-wrangler/domain';

/**
 * Compact internal domain events. Webhook adapters translate provider
 * payloads into these; the appliers persist them. Full raw payloads are
 * never stored.
 */

export interface RepositoryRef {
  workspaceExternalId: string;
  repositoryExternalId: string;
  fullName: string;
}

export type DomainEvent =
  | { type: 'workspace.upsert'; workspace: WorkspaceSnapshot }
  | { type: 'workspace.removed'; workspaceExternalId: string }
  | { type: 'repository.upsert'; ref: RepositoryRef; repository: RepositorySnapshot }
  | { type: 'repository.removed'; ref: RepositoryRef }
  | { type: 'branch.pushed'; ref: RepositoryRef; branchName: string; headSha: string; pushedAt?: string }
  | { type: 'branch.deleted'; ref: RepositoryRef; branchName: string }
  | { type: 'branch.upsert'; ref: RepositoryRef; branch: BranchSnapshot }
  | { type: 'pipeline_run.upsert'; ref: RepositoryRef; run: PipelineRunSnapshot }
  | { type: 'change_request.upsert'; ref: RepositoryRef; changeRequest: ChangeRequestSnapshot }
  | { type: 'security_finding.upsert'; ref: RepositoryRef; finding: SecurityFindingSnapshot }
  | { type: 'sync.requested'; jobType: string; scope: string; priority: number };
