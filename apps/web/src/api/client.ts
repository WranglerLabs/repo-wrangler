import { useQuery } from '@tanstack/react-query';
import type {
  ActivityEventDto,
  AttentionItemDto,
  ConnectionDto,
  ConnectionSecretHintDto,
  ConnectionWorkspaceDto,
  ConnectResultDto,
  CreditsDto,
  EstateBranchDto,
  EstateBudgetsDto,
  EstateChangeRequestDto,
  EstatePipelineDto,
  EstateSecurityFindingDto,
  GitLabGroupSearchResultDto,
  OnboardingStatusDto,
  OverviewDto,
  PlatformHealthDto,
  RepositoryDetailDto,
  RepositoryListItemDto,
  SavedViewDto,
  SessionUserDto,
  WorkspaceDto,
} from '@repo-wrangler/contracts';

export type MonitoringState = 'monitored' | 'ignored';

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

/**
 * Owner-approved addition (onboarding design front door): on a 401 from any
 * API call, send the browser to `/sign-in` rather than leaving a route to
 * dead-end on "Is the API reachable?". A full navigation (not client-side
 * routing) matches how every other sign-in transition in this app already
 * works, and needs no router context from a plain fetch helper.
 */
function redirectToSignIn(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/sign-in')) return; // avoid a self-redirect loop
  window.location.assign('/sign-in');
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: { accept: 'application/json' },
    // Send the session cookie cross-origin in Mode B; harmless same-origin.
    credentials: 'include',
  });
  if (!response.ok) {
    if (response.status === 401) redirectToSignIn();
    throw new ApiError(response.status, await readErrorMessage(response, `Request failed: ${response.status}`));
  }
  return (await response.json()) as T;
}

/** POST/PUT/PATCH/DELETE with a JSON body, the same 401 handling as `apiGet`. */
async function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401) redirectToSignIn();
    throw new ApiError(response.status, await readErrorMessage(response, `Request failed: ${response.status}`));
  }
  if (response.status === 204) return undefined as T;
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

// ---------------------------------------------------------------------------
// Onboarding design Phase B — first-run wizard, connect API, estate scope.
// ---------------------------------------------------------------------------

export function useOnboardingStatus() {
  return useQuery<OnboardingStatusDto>({
    queryKey: ['onboarding-status'],
    queryFn: () => apiGet('/api/v1/onboarding/status'),
    retry: false,
  });
}

export function useConnections() {
  return useQuery<ConnectionDto[]>({
    queryKey: ['connections'],
    queryFn: () => apiGet('/api/v1/connections'),
  });
}

export function useConnectionWorkspaces(
  connectionId: string | undefined,
  options?: { refetchInterval?: number },
) {
  return useQuery<ConnectionWorkspaceDto[]>({
    queryKey: ['connection-workspaces', connectionId],
    queryFn: () => apiGet(`/api/v1/connections/${connectionId}/workspaces`),
    enabled: !!connectionId,
    refetchInterval: options?.refetchInterval,
  });
}

/** B5 estate scope — the full inventory (both states) for one management screen. */
export function useEstateRepositories() {
  return useQuery<RepositoryListItemDto[]>({
    queryKey: ['estate-repositories', 'includeIgnored'],
    queryFn: () => apiGet('/api/v1/repositories?archived=true&includeIgnored=true'),
  });
}

/** Phase C2 — repositories discovered since the operator last reviewed the estate. */
export function useNewSinceReview() {
  return useQuery<RepositoryListItemDto[]>({
    queryKey: ['estate-new-since-review'],
    queryFn: () => apiGet('/api/v1/estate/new-since-review'),
    refetchInterval: REFRESH_MS,
  });
}

export async function markEstateReviewed(): Promise<{ ok: boolean; reviewedAt?: string }> {
  return apiSend('/api/v1/estate/mark-reviewed', 'POST');
}

/** Phase B5/C — re-lists what a connection's credentials can now see (growing the estate). */
export async function discoverConnectionWorkspaces(connectionId: string): Promise<ConnectionWorkspaceDto[]> {
  return apiGet(`/api/v1/connections/${connectionId}/workspaces`);
}

export async function exchangeGitHubApp(code: string): Promise<ConnectResultDto> {
  return apiSend('/api/v1/connections/github/exchange', 'POST', { code });
}

export interface GitHubPastedCredentials {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId?: string;
  clientSecret?: string;
}

export async function pasteGitHubCredentials(payload: GitHubPastedCredentials): Promise<ConnectResultDto> {
  return apiSend('/api/v1/connections/github/credentials', 'POST', payload);
}

export async function connectGitLab(baseUrl: string, token: string): Promise<ConnectResultDto> {
  return apiSend('/api/v1/connections/gitlab', 'POST', { baseUrl, token });
}

export async function searchGitLabGroups(
  connectionId: string,
  query: string,
): Promise<GitLabGroupSearchResultDto[]> {
  return apiGet(`/api/v1/connections/${connectionId}/search-groups?q=${encodeURIComponent(query)}`);
}

export async function createGitLabWorkspaces(
  connectionId: string,
  externalIds: string[],
): Promise<ConnectionWorkspaceDto[]> {
  return apiSend(`/api/v1/connections/${connectionId}/workspaces`, 'POST', { externalIds });
}

export async function setWorkspaceMonitoringState(id: string, state: MonitoringState): Promise<void> {
  await apiSend(`/api/v1/workspaces/${id}`, 'PATCH', { monitoring_state: state });
}

export async function setRepositoryMonitoringState(id: string, state: MonitoringState): Promise<void> {
  await apiSend(`/api/v1/repositories/${id}`, 'PATCH', { monitoring_state: state });
}

export function useConnectionCredentials(connectionId: string | undefined) {
  return useQuery<ConnectionSecretHintDto[]>({
    queryKey: ['connection-credentials', connectionId],
    queryFn: () => apiGet(`/api/v1/connections/${connectionId}/credentials`),
    enabled: !!connectionId,
  });
}

export async function rotateConnectionCredential(
  connectionId: string,
  name: string,
  value: string,
): Promise<void> {
  await apiSend(`/api/v1/connections/${connectionId}/credentials`, 'PUT', { name, value });
}

export async function disconnectConnection(connectionId: string): Promise<void> {
  await apiSend(`/api/v1/connections/${connectionId}`, 'DELETE');
}
