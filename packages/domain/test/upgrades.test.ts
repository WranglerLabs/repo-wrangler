import { describe, expect, it } from 'vitest';
import {
  canTransitionUpgradeJob,
  TERMINAL_UPGRADE_JOB_STATES,
  UPGRADE_JOB_STATES,
  missingUpgradeSafetyEvidence,
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

  it('fails closed at production boundaries until controller evidence is complete', () => {
    expect(missingUpgradeSafetyEvidence('validating_artifact', {}, 'sha256:target'))
      .toEqual(['verified_backup', 'restored_migration_validation']);
    const predeploy = {
      backup: { verified: true, id: 'backup-1', completedAt: '2026-09-04T00:00:00Z' },
      migrationValidation: {
        verified: true, restoredDatabaseId: 'restore-1', sourceSchema: 9,
        targetSchema: 10, completedAt: '2026-09-04T00:10:00Z',
      },
      artifact: {
        digest: 'sha256:target', checksumVerified: true, provenanceVerified: true,
        signatureVerified: true, imageAvailable: true,
      },
      rollback: { available: true, revision: 'old', imageDigest: 'sha256:old' },
    };
    expect(missingUpgradeSafetyEvidence('deploying', predeploy, 'sha256:target')).toEqual([]);
    expect(missingUpgradeSafetyEvidence('completed', predeploy, 'sha256:target'))
      .toEqual(['healthy_traffic_transition', 'application_health', 'schema_health']);
    expect(missingUpgradeSafetyEvidence('completed', {
      ...predeploy,
      deployment: { revision: 'new', imageDigest: 'sha256:target', trafficPercent: 100 },
      health: { application: true, schema: true, checkedAt: '2026-09-04T00:20:00Z' },
    }, 'sha256:target')).toEqual([]);
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
