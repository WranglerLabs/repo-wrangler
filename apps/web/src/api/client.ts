import { useQuery } from '@tanstack/react-query';
import type {
  ActivityEventDto,
  AttentionItemDto,
  CreditsDto,
  EstateBranchDto,
  EstateBudgetsDto,
  EstateChangeRequestDto,
  EstatePipelineDto,
  EstateSecurityFindingDto,
  OverviewDto,
  PlatformHealthDto,
  RepositoryDetailDto,
  RepositoryListItemDto,
  SessionUserDto,
  WorkspaceDto,
} from '@repo-wrangler/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

const REFRESH_MS = 60_000;

export function useOverview() {
  return useQuery<OverviewDto>({
    queryKey: ['overview'],
    queryFn: () => apiGet('/api/v1/overview'),
    refetchInterval: REFRESH_MS,
  });
}

export function useAttention() {
  return useQuery<AttentionItemDto[]>({
    queryKey: ['attention'],
    queryFn: () => apiGet('/api/v1/attention'),
    refetchInterval: REFRESH_MS,
  });
}

export function useRepositories(includeArchived = false) {
  return useQuery<RepositoryListItemDto[]>({
    queryKey: ['repositories', includeArchived],
    queryFn: () => apiGet(`/api/v1/repositories?archived=${includeArchived}`),
    refetchInterval: REFRESH_MS,
  });
}

export function useRepositoryDetail(id: string | undefined) {
  return useQuery<RepositoryDetailDto>({
    queryKey: ['repository', id],
    queryFn: () => apiGet(`/api/v1/repositories/${id}`),
    enabled: !!id,
  });
}

export function useEstateBranches() {
  return useQuery<EstateBranchDto[]>({
    queryKey: ['estate-branches'],
    queryFn: () => apiGet('/api/v1/branches'),
    refetchInterval: REFRESH_MS,
  });
}

export function useEstateChangeRequests() {
  return useQuery<EstateChangeRequestDto[]>({
    queryKey: ['estate-change-requests'],
    queryFn: () => apiGet('/api/v1/change-requests'),
    refetchInterval: REFRESH_MS,
  });
}

export function useEstatePipelines() {
  return useQuery<EstatePipelineDto[]>({
    queryKey: ['estate-pipelines'],
    queryFn: () => apiGet('/api/v1/pipelines'),
    refetchInterval: REFRESH_MS,
  });
}

export function useEstateSecurity() {
  return useQuery<EstateSecurityFindingDto[]>({
    queryKey: ['estate-security'],
    queryFn: () => apiGet('/api/v1/security'),
    refetchInterval: REFRESH_MS,
  });
}

export function useEstateBudgets() {
  return useQuery<EstateBudgetsDto>({
    queryKey: ['estate-budgets'],
    queryFn: () => apiGet('/api/v1/budgets'),
    refetchInterval: REFRESH_MS,
  });
}

export function useActivity() {
  return useQuery<ActivityEventDto[]>({
    queryKey: ['activity'],
    queryFn: () => apiGet('/api/v1/activity'),
    refetchInterval: REFRESH_MS,
  });
}

export function useWorkspaces() {
  return useQuery<WorkspaceDto[]>({
    queryKey: ['workspaces'],
    queryFn: () => apiGet('/api/v1/workspaces'),
    refetchInterval: REFRESH_MS,
  });
}

export function usePlatformHealth() {
  return useQuery<PlatformHealthDto>({
    queryKey: ['platform-health'],
    queryFn: () => apiGet('/api/v1/platform-health'),
    refetchInterval: REFRESH_MS,
  });
}

export function useCredits() {
  return useQuery<CreditsDto>({
    queryKey: ['credits'],
    queryFn: () => apiGet('/api/v1/credits'),
    staleTime: Infinity,
  });
}

export function useSessionUser() {
  return useQuery<SessionUserDto>({
    queryKey: ['me'],
    queryFn: () => apiGet('/auth/me'),
    retry: false,
  });
}

export async function triggerManualSync(): Promise<void> {
  const response = await fetch('/api/v1/admin/sync', { method: 'POST' });
  if (!response.ok) throw new ApiError(response.status, 'Sync request failed');
}
