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
