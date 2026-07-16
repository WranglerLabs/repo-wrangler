import type { WorkspaceDto } from '@repo-wrangler/contracts';

export const WORKSPACE_SORTS = ['name', 'repositories', 'attention', 'reconciled', 'provider'] as const;
export type WorkspaceSort = (typeof WORKSPACE_SORTS)[number];
export type WorkspaceSortDirection = 'asc' | 'desc';

export interface WorkspaceViewOptions {
  search: string;
  provider: string;
  kind: string;
  attention: string;
  monitoringState: string;
  sort: WorkspaceSort;
  direction: WorkspaceSortDirection;
}

function displayName(workspace: WorkspaceDto): string {
  return workspace.displayName ?? workspace.slug;
}

function attentionScore(workspace: WorkspaceDto): number {
  const counts = workspace.attentionCounts;
  return (counts.critical ?? 0) * 1_000_000
    + (counts.high ?? 0) * 10_000
    + (counts.medium ?? 0) * 100
    + (counts.low ?? 0);
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function applyWorkspaceView(
  workspaces: WorkspaceDto[],
  options: WorkspaceViewOptions,
): WorkspaceDto[] {
  const term = options.search.trim().toLowerCase();
  const filtered = workspaces.filter((workspace) => {
    if (options.provider !== 'all' && workspace.provider !== options.provider) return false;
    if (options.kind !== 'all' && workspace.kind !== options.kind) return false;
    if (options.attention !== 'all' && (workspace.attentionCounts[options.attention] ?? 0) === 0) return false;
    if (options.monitoringState !== 'all' && (workspace.monitoringState ?? 'monitored') !== options.monitoringState) return false;
    if (!term) return true;
    return [workspace.displayName, workspace.slug, workspace.provider, workspace.kind]
      .some((value) => value?.toLowerCase().includes(term));
  });

  const direction = options.direction === 'asc' ? 1 : -1;
  return filtered.sort((left, right) => {
    let result: number;
    switch (options.sort) {
      case 'repositories':
        result = left.repositoryCount - right.repositoryCount;
        break;
      case 'attention':
        result = attentionScore(left) - attentionScore(right);
        break;
      case 'reconciled':
        result = timestamp(left.lastReconciledAt) - timestamp(right.lastReconciledAt);
        break;
      case 'provider':
        result = left.provider.localeCompare(right.provider, undefined, { sensitivity: 'base' });
        break;
      default:
        result = displayName(left).localeCompare(displayName(right), undefined, { sensitivity: 'base' });
    }
    return result === 0
      ? displayName(left).localeCompare(displayName(right), undefined, { sensitivity: 'base' })
      : result * direction;
  });
}

