import { describe, expect, it } from 'vitest';
import type { RepositoryListItemDto } from '@repo-wrangler/contracts';
import { applyRepositoryView, type RepositoryViewOptions } from '../src/lib/repositoryView';

const base: RepositoryViewOptions = {
  search: '',
  level: 'all',
  provider: 'all',
  workspace: 'all',
  language: 'all',
  status: 'all',
  sort: 'name',
  direction: 'asc',
};

const repositories: RepositoryListItemDto[] = [
  {
    id: '1', provider: 'github', workspaceSlug: 'alpha', name: 'zeta', fullName: 'alpha/zeta',
    isArchived: false, defaultBranchStatus: 'current', branchesAhead: 0,
    openChangeRequests: 1, attentionLevel: 'healthy', primaryLanguage: 'TypeScript',
    pushedAt: '2026-01-01T00:00:00Z', lastSyncedAt: '2026-01-03T00:00:00Z', status: 'active',
  },
  {
    id: '2', provider: 'gitlab', workspaceSlug: 'beta', name: 'api', fullName: 'beta/api',
    isArchived: false, defaultBranchStatus: 'diverged', branchesAhead: 2,
    openChangeRequests: 4, attentionLevel: 'critical', primaryLanguage: 'Go',
    pushedAt: '2026-01-02T00:00:00Z', lastSyncedAt: '2026-01-02T00:00:00Z', status: 'inaccessible',
  },
];

describe('applyRepositoryView', () => {
  it('searches provider, workspace, language, and repository fields', () => {
    expect(applyRepositoryView(repositories, { ...base, search: 'gitlab' }).map((r) => r.id)).toEqual(['2']);
    expect(applyRepositoryView(repositories, { ...base, search: 'typescript' }).map((r) => r.id)).toEqual(['1']);
  });

  it('combines filters', () => {
    const result = applyRepositoryView(repositories, {
      ...base, provider: 'gitlab', workspace: 'beta', language: 'Go', status: 'inaccessible', level: 'critical',
    });
    expect(result.map((r) => r.id)).toEqual(['2']);
  });

  it('sorts by attention, dates, and counts in either direction', () => {
    expect(applyRepositoryView(repositories, { ...base, sort: 'attention' }).map((r) => r.id)).toEqual(['2', '1']);
    expect(applyRepositoryView(repositories, { ...base, sort: 'activity', direction: 'desc' }).map((r) => r.id)).toEqual(['2', '1']);
    expect(applyRepositoryView(repositories, { ...base, sort: 'changeRequests', direction: 'desc' }).map((r) => r.id)).toEqual(['2', '1']);
  });
});

