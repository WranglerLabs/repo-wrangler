/**
 * Minimal GitLab REST v4 client for Workers. Supports GitLab.com and
 * self-managed instances via a configurable base URL. Token is a PAT or
 * group/project access token with read_api scope.
 */

export interface GitLabResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  nextPage?: number;
  /** Total matching records, from GitLab's `X-Total` pagination header. */
  total?: number;
}

export class GitLabClient {
  private readonly apiBase: string;

  constructor(
    private readonly token: string,
    baseUrl = 'https://gitlab.com',
  ) {
    this.apiBase = `${baseUrl.replace(/\/+$/, '')}/api/v4`;
  }

  async request<T>(path: string): Promise<GitLabResponse<T>> {
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: {
        'private-token': this.token,
        accept: 'application/json',
        'user-agent': 'repo-wrangler',
      },
    });
    let data: T | undefined;
    try {
      data = (await response.json()) as T;
    } catch {
      data = undefined;
    }
    const nextPageHeader = response.headers.get('x-next-page');
    const nextPage = nextPageHeader ? Number(nextPageHeader) : undefined;
    const totalHeader = response.headers.get('x-total');
    const total = totalHeader ? Number(totalHeader) : undefined;
    return {
      ok: response.ok,
      status: response.status,
      data,
      nextPage: nextPage && !Number.isNaN(nextPage) ? nextPage : undefined,
      total: total !== undefined && !Number.isNaN(total) ? total : undefined,
    };
  }
}

export interface GitLabTokenCapability {
  status:
    | 'read_scope_verified'
    | 'write_scope_detected'
    | 'insufficient_read_scope'
    | 'token_inactive'
    | 'token_introspection_unavailable';
  details: Record<string, string>;
}

interface GitLabTokenInfo {
  active?: boolean;
  revoked?: boolean;
  expires_at?: string | null;
  scopes?: unknown;
  granular_scopes?: unknown;
}

/**
 * Inspect the credential without changing it. Older self-managed GitLab
 * versions may not expose this endpoint, so callers get an explicit
 * capability result instead of treating missing metadata as read access.
 */
export async function inspectGitLabToken(client: GitLabClient): Promise<GitLabTokenCapability> {
  let response: GitLabResponse<GitLabTokenInfo>;
  try {
    response = await client.request<GitLabTokenInfo>('/personal_access_tokens/self');
  } catch {
    return {
      status: 'token_introspection_unavailable',
      details: { introspection: 'request_failed' },
    };
  }

  if (!response.ok || !response.data) {
    return {
      status: 'token_introspection_unavailable',
      details: { introspection: `http_${response.status}` },
    };
  }

  const token = response.data;
  const scopes = Array.isArray(token.scopes)
    ? token.scopes.filter((scope): scope is string => typeof scope === 'string')
    : [];
  const granular = Array.isArray(token.granular_scopes)
    ? token.granular_scopes.filter(
        (entry): entry is { access?: string; permissions?: string[] } =>
          typeof entry === 'object' && entry !== null,
      )
    : [];
  const granularPermissions = granular.flatMap((entry) =>
    Array.isArray(entry.permissions)
      ? entry.permissions.filter((permission): permission is string => typeof permission === 'string')
      : [],
  );
  const details: Record<string, string> = {
    active: String(token.active !== false && token.revoked !== true),
    standardScopes: scopes.length > 0 ? scopes.sort().join(',') : 'none_reported',
    granularPermissions: granularPermissions.length > 0
      ? [...new Set(granularPermissions)].sort().join(',')
      : 'none_reported',
  };
  if (token.expires_at) details.expiresAt = token.expires_at;

  if (token.active === false || token.revoked === true) {
    return { status: 'token_inactive', details };
  }

  const writeScopes = new Set([
    'api', 'sudo', 'admin_mode', 'manage_runner', 'create_runner',
  ]);
  const hasWrite = scopes.some((scope) => writeScopes.has(scope) || scope.startsWith('write_'))
    || granularPermissions.some((permission) =>
      /^(create|delete|manage|admin|update|write|rotate|revoke)_/.test(permission),
    );
  if (hasWrite) return { status: 'write_scope_detected', details };

  const hasReadApi = scopes.includes('read_api')
    || granularPermissions.some((permission) => /^(read|view|list|get)_/.test(permission));
  return {
    status: hasReadApi ? 'read_scope_verified' : 'insufficient_read_scope',
    details,
  };
}
