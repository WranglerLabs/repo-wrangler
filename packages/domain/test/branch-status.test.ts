import { describe, expect, it } from 'vitest';
import {
  classifyComparison,
  evaluateDefaultBranchStatus,
  isExcludedBranchName,
} from '../src/branch-status';
import type { BranchSnapshot } from '../src/entities';

function branch(overrides: Partial<BranchSnapshot>): BranchSnapshot {
  return {
    name: 'feature/x',
    isDefault: false,
    isProtected: false,
    comparisonStatus: 'unknown',
    excluded: false,
    ...overrides,
  };
}

describe('classifyComparison', () => {
  it('classifies identical, ahead, behind, diverged, unknown', () => {
    expect(classifyComparison(0, 0)).toBe('identical');
    expect(classifyComparison(3, 0)).toBe('ahead');
    expect(classifyComparison(0, 2)).toBe('behind');
    expect(classifyComparison(4, 7)).toBe('diverged');
    expect(classifyComparison(undefined, 1)).toBe('unknown');
  });
});

describe('isExcludedBranchName', () => {
  it('excludes dependency-bot and release branches by default', () => {
    expect(isExcludedBranchName('dependabot/npm_and_yarn/foo-1.2.3')).toBe(true);
    expect(isExcludedBranchName('renovate/react-19.x')).toBe(true);
    expect(isExcludedBranchName('release/2.0')).toBe(true);
    expect(isExcludedBranchName('feature/dashboard')).toBe(false);
  });
});

describe('evaluateDefaultBranchStatus', () => {
  it('is current when there are no non-excluded active branches', () => {
    const result = evaluateDefaultBranchStatus([
      branch({ name: 'main', isDefault: true, comparisonStatus: 'identical' }),
      branch({ name: 'dependabot/x', excluded: true, comparisonStatus: 'ahead', aheadBy: 1 }),
    ]);
    expect(result.status).toBe('current');
  });

  it('reports untracked work when a branch is ahead without a change request', () => {
    const result = evaluateDefaultBranchStatus([
      branch({ name: 'feature/a', comparisonStatus: 'ahead', aheadBy: 19 }),
    ]);
    expect(result.status).toBe('untracked_work');
    expect(result.reasons[0]).toContain('feature/a');
  });

  it('reports work pending when the ahead branch has an open change request', () => {
    const result = evaluateDefaultBranchStatus([
      branch({
        name: 'feature/b',
        comparisonStatus: 'ahead',
        aheadBy: 2,
        openChangeRequestNumber: 42,
      }),
    ]);
    expect(result.status).toBe('work_pending');
  });

  it('diverged wins over ahead', () => {
    const result = evaluateDefaultBranchStatus([
      branch({ name: 'feature/a', comparisonStatus: 'ahead', aheadBy: 1 }),
      branch({ name: 'old/base', comparisonStatus: 'diverged', aheadBy: 3, behindBy: 9 }),
    ]);
    expect(result.status).toBe('diverged');
  });

  it('is unknown when no comparison data exists at all', () => {
    const result = evaluateDefaultBranchStatus([
      branch({ name: 'feature/a', comparisonStatus: 'unknown' }),
    ]);
    expect(result.status).toBe('unknown');
  });
});
