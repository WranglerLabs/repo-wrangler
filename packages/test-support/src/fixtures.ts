/**
 * Deterministic domain fixtures for unit/contract tests across packages. Each
 * builder returns a valid snapshot with sensible defaults; pass a partial to
 * override any field. Timestamps are fixed so tests never depend on the clock.
 */
import type {
  BranchSnapshot,
  BudgetSnapshot,
  ChangeRequestSnapshot,
  PipelineRunSnapshot,
  RepositorySnapshot,
  SecurityFindingSnapshot,
  WorkspaceSnapshot,
} from '@repo-wrangler/domain';

const T = '2026-01-01T00:00:00.000Z';

export function makeWorkspaceSnapshot(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    externalId: 'ws-1',
    slug: 'acme',
    displayName: 'Acme',
    kind: 'organization',
    ...overrides,
  };
}

export function makeRepositorySnapshot(
  overrides: Partial<RepositorySnapshot> = {},
): RepositorySnapshot {
  return {
    externalId: 'repo-1',
    name: 'widget',
    fullName: 'acme/widget',
    url: 'https://example.test/acme/widget',
    isArchived: false,
    isFork: false,
    isDisabled: false,
    isTemplate: false,
    defaultBranch: 'main',
    pushedAt: T,
    topics: [],
    ...overrides,
  };
}

export function makeBranchSnapshot(overrides: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    name: 'main',
    headSha: 'a'.repeat(40),
    headCommittedAt: T,
    isDefault: true,
    isProtected: true,
    comparisonStatus: 'identical',
    excluded: false,
    ...overrides,
  };
}

export function makePipelineRunSnapshot(
  overrides: Partial<PipelineRunSnapshot> = {},
): PipelineRunSnapshot {
  return {
    externalId: 'run-1',
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    branch: 'main',
    runStartedAt: T,
    completedAt: T,
    ...overrides,
  };
}

export function makeChangeRequestSnapshot(
  overrides: Partial<ChangeRequestSnapshot> = {},
): ChangeRequestSnapshot {
  return {
    number: 1,
    title: 'Add widget',
    author: 'octocat',
    isDraft: false,
    state: 'open',
    baseRef: 'main',
    headRef: 'feature/widget',
    requestedReviewers: [],
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

export function makeSecurityFindingSnapshot(
  overrides: Partial<SecurityFindingSnapshot> = {},
): SecurityFindingSnapshot {
  return {
    externalId: 'find-1',
    category: 'code_scanning',
    severity: 'high',
    state: 'open',
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

export function makeBudgetSnapshot(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    externalId: 'budget-1',
    product: 'actions',
    scopeType: 'organization',
    scopeTarget: 'acme',
    amount: 100,
    unit: 'USD',
    preventFurtherUsage: false,
    ...overrides,
  };
}
