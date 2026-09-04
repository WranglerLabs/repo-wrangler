import { describe, expect, it } from 'vitest';
import type { AdministrationUpdatesDto } from '@repo-wrangler/contracts';
import {
  availableJobActions,
  upgradeAvailabilityMessage,
  upgradeEvidenceFacts,
  upgradeStateBadge,
} from '../src/lib/upgradeView';

type Job = AdministrationUpdatesDto['jobs'][number];

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1', deploymentTarget: 'production', controllerType: 'azure-devops',
    state: 'accepted', actorId: 'owner', correlationId: 'correlation',
    sourceVersion: 'v1.0.23', sourceDigest: `sha256:${'a'.repeat(64)}`,
    targetVersion: 'v1.0.24', targetDigest: `sha256:${'b'.repeat(64)}`,
    requestedAt: '2026-09-04T00:00:00Z', controllerCorrelationId: '809',
    controllerEvidence: {}, ...overrides,
  };
}

describe('Administration Updates presentation', () => {
  it('offers only lifecycle-valid protected actions', () => {
    expect(availableJobActions(job())).toEqual(['cancel']);
    expect(availableJobActions(job({ state: 'completed', controllerEvidence: {
      rollback: { available: true, revision: 'previous', imageDigest: `sha256:${'a'.repeat(64)}` },
    } }))).toEqual(['rollback']);
    expect(availableJobActions(job({ state: 'failed', controllerEvidence: {} }))).toEqual([]);
  });

  it('does not represent missing safety evidence as successful', () => {
    const facts = upgradeEvidenceFacts(job({ state: 'failed', controllerEvidence: {
      failure: { productionPreserved: false, verifiedAt: '' },
    } }));
    expect(facts.find((fact) => fact.id === 'backup')?.state).toBe('unavailable');
    expect(facts.find((fact) => fact.id === 'health')?.state).toBe('failed');
    expect(facts.find((fact) => fact.id === 'failure')?.state).toBe('failed');
  });

  it('gives manual installations honest instructions instead of an upgrade action', () => {
    const data = {
      controller: { availability: 'manual', detail: 'Use the deployment runbook.' },
    } as AdministrationUpdatesDto;
    expect(upgradeAvailabilityMessage(data)).toBe('Use the deployment runbook.');
  });

  it('maps successful and failed states to distinct badges', () => {
    expect(upgradeStateBadge('completed')).toBe('healthy');
    expect(upgradeStateBadge('failed')).toBe('critical');
    expect(upgradeStateBadge('deploying')).toBe('info');
  });
});
