import { describe, expect, it } from 'vitest';
import { evaluateRepositoryHealth } from '../src/health';
import type { RepositoryHealthInput } from '../src/health';
import { capabilityAvailable, capabilityUnavailable } from '../src/capabilities';
import type { RepositorySnapshot } from '../src/entities';

const NOW = new Date('2026-07-12T00:00:00Z');

function repo(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    externalId: '1',
    name: 'demo',
    fullName: 'acme/demo',
    isArchived: false,
    isFork: false,
    isDisabled: false,
    isTemplate: false,
    defaultBranch: 'main',
    pushedAt: '2026-07-10T00:00:00Z',
    topics: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<RepositoryHealthInput> = {}): RepositoryHealthInput {
  return {
    repository: repo(),
    branches: [],
    openChangeRequests: [],
    securityFindings: capabilityUnavailable('not_configured'),
    now: NOW,
    ...overrides,
  };
}

describe('evaluateRepositoryHealth', () => {
  it('flags open secret scanning alerts as critical', () => {
    const health = evaluateRepositoryHealth(
      baseInput({
        securityFindings: capabilityAvailable([
          {
            externalId: 's1',
            category: 'secret_scanning' as const,
            state: 'open',
          },
        ]),
      }),
    );
    expect(health.level).toBe('critical');
    expect(health.findings[0]?.code).toBe('security.secret_exposure');
  });

  it('flags a failing default-branch run as high', () => {
    const health = evaluateRepositoryHealth(
      baseInput({
        latestDefaultBranchRun: {
          externalId: 'r1',
          name: 'ci',
          status: 'completed',
          conclusion: 'failure',
        },
      }),
    );
    expect(health.level).toBe('high');
  });

  it('flags inactivity as low', () => {
    const health = evaluateRepositoryHealth(
      baseInput({ repository: repo({ pushedAt: '2025-06-01T00:00:00Z' }) }),
    );
    expect(health.level).toBe('low');
    expect(health.findings.some((f) => f.code === 'activity.inactive')).toBe(true);
  });

  it('archived repositories are healthy and skip policy checks', () => {
    const health = evaluateRepositoryHealth(
      baseInput({ repository: repo({ isArchived: true, pushedAt: '2020-01-01T00:00:00Z' }) }),
    );
    expect(health.level).toBe('healthy');
  });

  it('healthy when nothing is wrong', () => {
    const health = evaluateRepositoryHealth(
      baseInput({
        latestDefaultBranchRun: {
          externalId: 'r2',
          status: 'completed',
          conclusion: 'success',
        },
      }),
    );
    expect(health.level).toBe('healthy');
  });
});
