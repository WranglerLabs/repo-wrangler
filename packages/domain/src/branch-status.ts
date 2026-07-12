import type { BranchComparisonStatus, BranchSnapshot } from './entities';

/**
 * Default-branch status per FR-005. RepoWrangler never reduces branch health
 * to "which commit timestamp is newest".
 */
export type DefaultBranchStatus =
  | 'current'
  | 'work_pending'
  | 'untracked_work'
  | 'diverged'
  | 'unknown';

/** Classify one branch's relationship to the default branch. */
export function classifyComparison(
  aheadBy: number | undefined,
  behindBy: number | undefined,
): BranchComparisonStatus {
  if (aheadBy === undefined || behindBy === undefined) return 'unknown';
  if (aheadBy > 0 && behindBy > 0) return 'diverged';
  if (aheadBy > 0) return 'ahead';
  if (behindBy > 0) return 'behind';
  return 'identical';
}

/** Default branch-name exclusion patterns (configurable per instance). */
export const DEFAULT_BRANCH_EXCLUSIONS = [
  /^dependabot\//,
  /^renovate\//,
  /^release\//,
  /^gh-pages$/,
];

export function isExcludedBranchName(
  name: string,
  patterns: RegExp[] = DEFAULT_BRANCH_EXCLUSIONS,
): boolean {
  return patterns.some((p) => p.test(name));
}

export interface DefaultBranchEvaluation {
  status: DefaultBranchStatus;
  reasons: string[];
}

/**
 * Evaluate the estate meaning of "is the default branch current?" from the
 * comparison state of all non-excluded active branches.
 */
export function evaluateDefaultBranchStatus(
  branches: BranchSnapshot[],
): DefaultBranchEvaluation {
  const considered = branches.filter((b) => !b.isDefault && !b.excluded);

  if (considered.length === 0) {
    return { status: 'current', reasons: ['No non-excluded active branches.'] };
  }

  const unknown = considered.filter((b) => b.comparisonStatus === 'unknown');
  const diverged = considered.filter((b) => b.comparisonStatus === 'diverged');
  const ahead = considered.filter((b) => b.comparisonStatus === 'ahead');

  if (diverged.length > 0) {
    return {
      status: 'diverged',
      reasons: diverged.map(
        (b) => `Branch ${b.name} is both ahead and behind the default branch.`,
      ),
    };
  }

  const aheadWithoutCr = ahead.filter((b) => b.openChangeRequestNumber === undefined);
  const aheadWithCr = ahead.filter((b) => b.openChangeRequestNumber !== undefined);

  if (aheadWithoutCr.length > 0) {
    return {
      status: 'untracked_work',
      reasons: aheadWithoutCr.map(
        (b) => `Branch ${b.name} is ${b.aheadBy ?? '?'} commit(s) ahead with no open change request.`,
      ),
    };
  }

  if (aheadWithCr.length > 0) {
    return {
      status: 'work_pending',
      reasons: aheadWithCr.map(
        (b) => `Branch ${b.name} is ahead with open change request #${b.openChangeRequestNumber}.`,
      ),
    };
  }

  if (unknown.length === considered.length) {
    return {
      status: 'unknown',
      reasons: ['No branch comparisons available (permissions, rate limit, or not yet compared).'],
    };
  }

  return { status: 'current', reasons: ['No non-excluded branch is ahead of the default branch.'] };
}
