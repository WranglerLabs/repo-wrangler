import { describe, expect, it } from 'vitest';
import {
  canTransitionUpgradeJob,
  TERMINAL_UPGRADE_JOB_STATES,
  UPGRADE_JOB_STATES,
} from '../src/upgrades';

describe('upgrade lifecycle state machine', () => {
  it('supports the complete successful controller lifecycle', () => {
    const path = [
      'requested', 'accepted', 'preflight', 'backup', 'validating_artifact',
      'deploying', 'verifying', 'completed',
    ] as const;
    for (let index = 1; index < path.length; index += 1) {
      expect(canTransitionUpgradeJob(path[index - 1]!, path[index]!)).toBe(true);
    }
  });

  it('supports safe cancellation and rollback without arbitrary state jumps', () => {
    expect(canTransitionUpgradeJob('preflight', 'cancel_requested')).toBe(true);
    expect(canTransitionUpgradeJob('cancel_requested', 'canceled')).toBe(true);
    expect(canTransitionUpgradeJob('failed', 'rollback_requested')).toBe(true);
    expect(canTransitionUpgradeJob('rollback_requested', 'rolling_back')).toBe(true);
    expect(canTransitionUpgradeJob('rolling_back', 'rolled_back')).toBe(true);
    expect(canTransitionUpgradeJob('requested', 'completed')).toBe(false);
    expect(canTransitionUpgradeJob('deploying', 'canceled')).toBe(false);
  });

  it('keeps terminal states explicit and every declared state governed', () => {
    expect(TERMINAL_UPGRADE_JOB_STATES).toEqual([
      'completed', 'canceled', 'failed', 'rolled_back',
    ]);
    for (const state of TERMINAL_UPGRADE_JOB_STATES) {
      expect(UPGRADE_JOB_STATES).toContain(state);
    }
  });
});
