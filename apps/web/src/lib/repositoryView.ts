import type { RepositoryListItemDto } from '@repo-wrangler/contracts';

export const REPOSITORY_SORTS = [
  'name',
  'attention',
  'activity',
  'synced',
  'changeRequests',
] as const;

export type RepositorySort = (typeof REPOSITORY_SORTS)[number];
export type SortDirection = 'asc' | 'desc';

export interface RepositoryViewOptions {
  search: string;
  level: string;
  provider: string;
  workspace: string;
  language: string;
  status: string;
  sort: RepositorySort;
  direction: SortDirection;
}

const ATTENTION_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
  healthy: 5,
};

function compareText(left: string | undefined, right: string | undefined): number {
  return (left ?? '').localeCompare(right ?? '', undefined, { sensitivity: 'base' });
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function applyRepositoryView(
  repositories: RepositoryListItemDto[],
  options: RepositoryViewOptions,
): RepositoryListItemDto[] {
  const term = options.search.trim().toLowerCase();
  const filtered = repositories.filter((repo) => {
    if (options.level !== 'all' && repo.attentionLevel !== options.level) return false;
    if (options.provider !== 'all' && repo.provider !== options.provider) return false;
    if (options.workspace !== 'all' && repo.workspaceSlug !== options.workspace) return false;
    if (options.language !== 'all' && (repo.primaryLanguage ?? '') !== options.language) return false;
    if (options.status !== 'all' && repo.status !== options.status) return false;
    if (!term) return true;
    return [repo.name, repo.fullName, repo.workspaceSlug, repo.provider, repo.primaryLanguage]
      .some((value) => value?.toLowerCase().includes(term));
  });

  const direction = options.direction === 'asc' ? 1 : -1;
  return filtered.sort((left, right) => {
    let result: number;
    switch (options.sort) {
      case 'attention':
        result = (ATTENTION_ORDER[left.attentionLevel] ?? 99) - (ATTENTION_ORDER[right.attentionLevel] ?? 99);
        break;
      case 'activity':
        result = timestamp(left.pushedAt) - timestamp(right.pushedAt);
        break;
      case 'synced':
        result = timestamp(left.lastSyncedAt) - timestamp(right.lastSyncedAt);
        break;
      case 'changeRequests':
        result = left.openChangeRequests - right.openChangeRequests;
        break;
      default:
        result = compareText(left.fullName, right.fullName);
    }
    return result === 0 ? compareText(left.fullName, right.fullName) : result * direction;
  });
}

