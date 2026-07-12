import { GitHubClient } from './client';
import { createAppJwt } from './jwt';

/** GitHub App–level operations: installations and installation tokens. */

export interface GitHubInstallation {
  id: number;
  account: {
    id: number;
    login: string;
    type: string;
    avatar_url?: string;
  } | null;
  repository_selection?: string;
  suspended_at?: string | null;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

export async function listInstallations(
  appId: string,
  privateKeyPem: string,
): Promise<GitHubInstallation[]> {
  const jwt = await createAppJwt(appId, privateKeyPem);
  const client = new GitHubClient(jwt);
  const installations: GitHubInstallation[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await client.request<GitHubInstallation[]>(
      `/app/installations?per_page=100&page=${page}`,
    );
    if (!response.ok || !response.data) {
      throw new Error(`Failed to list installations (HTTP ${response.status}).`);
    }
    installations.push(...response.data);
    if (response.data.length < 100) break;
  }
  return installations;
}

const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

/**
 * Mint (or reuse from in-isolate memory) a short-lived installation access
 * token. Tokens are never persisted to D1 or returned to the client.
 */
export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string | number,
): Promise<string> {
  const cacheKey = String(installationId);
  const cached = tokenCache.get(cacheKey);
  // 2-minute expiry buffer.
  if (cached && cached.expiresAtMs - Date.now() > 2 * 60 * 1000) {
    return cached.token;
  }

  const jwt = await createAppJwt(appId, privateKeyPem);
  const client = new GitHubClient(jwt);
  const response = await client.request<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { method: 'POST' },
  );
  if (!response.ok || !response.data) {
    throw new Error(
      `Failed to create installation token for ${installationId} (HTTP ${response.status}).`,
    );
  }
  tokenCache.set(cacheKey, {
    token: response.data.token,
    expiresAtMs: Date.parse(response.data.expires_at),
  });
  return response.data.token;
}
