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
  SavedViewDto,
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

// Host-agnostic API base (ADR-011). Empty (default) ⇒ same-origin relative
// requests, the integrated Cloudflare Worker topology (Mode A). Set
// VITE_API_BASE_URL at build time to point a decoupled SPA (GitHub Pages, Azure
// SWA, …) at a Worker on another origin (Mode B); the Worker must then allow this
// SPA's origin via CORS_ALLOWED_ORIGINS.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/** Resolve an app-relative API path against the configured API base. */
export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: { accept: 'application/json' },
    // Send the session cookie cross-origin in Mode B; harmless same-origin.
    credentials: 'include',
  });
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

export interface AuthProviderOption {
  id: string;
  label: string;
  loginUrl: string;
}

export interface AuthConfigDto {
  demo: boolean;
  providers: AuthProviderOption[];
  /** Deployed application version (e.g. "0.4.0"). */
  version?: string;
}

export function useAuthConfig() {
  return useQuery<AuthConfigDto>({
    queryKey: ['auth-config'],
    queryFn: () => apiGet('/auth/config'),
    staleTime: Infinity,
  });
}

/** One sign-in link+label per enabled provider (ADR-019). */
export function signInOptions(
  config: AuthConfigDto | undefined,
): { href: string; label: string }[] {
  const providers = config?.providers ?? [];
  if (providers.length === 0) {
    return [{ href: '/auth/github/login', label: 'Sign in with GitHub' }];
  }
  return providers.map((p) => ({ href: p.loginUrl, label: `Sign in with ${p.label}` }));
}

/** First configured provider — for spots that show a single sign-in link. */
export function signInFor(config: AuthConfigDto | undefined): { href: string; label: string } {
  return signInOptions(config)[0]!;
}

export function useSavedViews() {
  return useQuery<SavedViewDto[]>({
    queryKey: ['saved-views'],
    queryFn: () => apiGet('/api/v1/views'),
    staleTime: 5 * 60_000,
  });
}

export async function createSavedView(name: string, definition: unknown): Promise<void> {
  const response = await fetch(apiUrl('/api/v1/views'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, definition }),
  });
  if (!response.ok) throw new ApiError(response.status, 'Could not save view');
}

export async function deleteSavedView(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/v1/views/${id}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) throw new ApiError(response.status, 'Could not delete view');
}

export async function triggerManualSync(): Promise<void> {
  const response = await fetch(apiUrl('/api/v1/admin/sync'), {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new ApiError(response.status, 'Sync request failed');
}
