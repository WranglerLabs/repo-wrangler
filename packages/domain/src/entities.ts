/**
 * Provider-neutral domain entities. Adapters translate GitHub/GitLab API
 * responses into these shapes; the UI and persistence layers never see raw
 * provider payloads.
 */

export type ProviderType = 'github' | 'gitlab' | 'mock';

/**
 * Estate scope lever (ADR-020). `monitored` is the default: discovery scans
 * it, it counts in the estate, enrichment and health run against it.
 * `ignored` keeps it in the inventory but excludes it from estate reads and
 * enrichment, and — for a workspace — from per-repo pagination during
 * discovery.
 */
export type MonitoringState = 'monitored' | 'ignored';

export interface WorkspaceSnapshot {
  externalId: string;
  installationId?: string;
  slug: string;
  displayName?: string;
  kind: 'organization' | 'user' | 'group';
  avatarUrl?: string;
  plan?: string;
}

export interface RepositorySnapshot {
  externalId: string;
  nodeId?: string;
  name: string;
  fullName: string;
  url?: string;
  description?: string;
  visibility?: string;
  isArchived: boolean;
  isFork: boolean;
  isDisabled: boolean;
  isTemplate: boolean;
  defaultBranch?: string;
  pushedAt?: string;
  providerUpdatedAt?: string;
  primaryLanguage?: string;
  topics: string[];
  licenseSpdx?: string;
  sizeKb?: number;
}

export type BranchComparisonStatus =
  | 'identical'
  | 'ahead'
  | 'behind'
  | 'diverged'
  | 'unknown';

export interface BranchSnapshot {
  name: string;
  headSha?: string;
  headCommittedAt?: string;
  isDefault: boolean;
  isProtected: boolean;
  aheadBy?: number;
  behindBy?: number;
  comparisonStatus: BranchComparisonStatus;
  comparedAt?: string;
  openChangeRequestNumber?: number;
  excluded: boolean;
  excludedReason?: string;
}

export type PipelineRunStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'unknown';

export type PipelineRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'skipped'
  | 'neutral'
  | 'action_required'
  | 'stale'
  | 'unknown';

export interface PipelineRunSnapshot {
  externalId: string;
  name?: string;
  status: PipelineRunStatus;
  conclusion?: PipelineRunConclusion;
  branch?: string;
  headSha?: string;
  event?: string;
  actor?: string;
  url?: string;
  runStartedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  attempt?: number;
  failureSummary?: string;
}

export type ChangeRequestState = 'open' | 'merged' | 'closed';

export interface ChangeRequestSnapshot {
  number: number;
  title?: string;
  url?: string;
  author?: string;
  isDraft: boolean;
  state: ChangeRequestState;
  baseRef?: string;
  headRef?: string;
  headSha?: string;
  reviewDecision?: string;
  requestedReviewers: string[];
  mergeableState?: string;
  checksStatus?: string;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string;
  closedAt?: string;
}

export type SecurityFindingCategory =
  | 'code_scanning'
  | 'secret_scanning'
  | 'dependency';

export interface SecurityFindingSnapshot {
  externalId: string;
  category: SecurityFindingCategory;
  severity?: string;
  state?: string;
  ruleId?: string;
  ref?: string;
  url?: string;
  /** Redacted summary only — never secret values or code snippets. */
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
}

export interface GovernanceInfo {
  /** Derived from the default branch's protection flag when known. */
  defaultBranchProtected?: boolean;
  files?: {
    readme?: boolean;
    license?: boolean;
    contributing?: boolean;
    codeOfConduct?: boolean;
    issueTemplate?: boolean;
    pullRequestTemplate?: boolean;
  };
  healthPercentage?: number;
}

export interface BudgetSnapshot {
  externalId: string;
  product?: string;
  scopeType?: string;
  scopeTarget?: string;
  amount?: number;
  unit?: string;
  preventFurtherUsage: boolean;
  alertStatus?: string;
}
