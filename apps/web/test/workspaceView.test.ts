import { describe, expect, it } from 'vitest';
import type { WorkspaceDto } from '@repo-wrangler/contracts';
import { applyWorkspaceView, type WorkspaceViewOptions } from '../src/lib/workspaceView';

const base: WorkspaceViewOptions = {
  search: '', provider: 'all', kind: 'all', attention: 'all', monitoringState: 'all',
  sort: 'name', direction: 'asc',
};

const workspaces: WorkspaceDto[] = [
  {
    id: '1', provider: 'github', slug: 'alpha', displayName: 'Alpha Org', kind: 'organization',
    repositoryCount: 12, attentionCounts: { critical: 0, high: 1 },
    lastReconciledAt: '2026-01-01T00:00:00Z', monitoringState: 'monitored',
  },
  {
    id: '2', provider: 'gitlab', slug: 'beta', displayName: 'Beta Group', kind: 'group',
    repositoryCount: 40, attentionCounts: { critical: 2, high: 0 },
    lastReconciledAt: '2026-01-02T00:00:00Z', monitoringState: 'ignored',
  },
];

describe('applyWorkspaceView', () => {
  it('searches display name, slug, provider, and kind', () => {
    expect(applyWorkspaceView(workspaces, { ...base, search: 'gitlab' }).map((w) => w.id)).toEqual(['2']);
    expect(applyWorkspaceView(workspaces, { ...base, search: 'alpha org' }).map((w) => w.id)).toEqual(['1']);
  });

  it('combines provider, kind, attention, and monitoring filters', () => {
    const result = applyWorkspaceView(workspaces, {
      ...base, provider: 'gitlab', kind: 'group', attention: 'critical', monitoringState: 'ignored',
    });
    expect(result.map((w) => w.id)).toEqual(['2']);
  });

  it('sorts large result sets by repository count, attention, and reconciliation time', () => {
    expect(applyWorkspaceView(workspaces, { ...base, sort: 'repositories', direction: 'desc' }).map((w) => w.id)).toEqual(['2', '1']);
    expect(applyWorkspaceView(workspaces, { ...base, sort: 'attention', direction: 'desc' }).map((w) => w.id)).toEqual(['2', '1']);
    expect(applyWorkspaceView(workspaces, { ...base, sort: 'reconciled', direction: 'desc' }).map((w) => w.id)).toEqual(['2', '1']);
  });
});

