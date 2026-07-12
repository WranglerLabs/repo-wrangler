/**
 * Minimal GitHub REST client for Workers. Captures rate-limit headers on
 * every call and never logs token material.
 */

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';

export interface RateLimitInfo {
  remaining?: number;
  reset?: number;
  used?: number;
}

export interface GitHubResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  rateLimit: RateLimitInfo;
  /** RFC 5988 Link header, used for pagination. */
  link?: string;
}

export interface GitHubClientOptions {
  userAgent?: string;
  baseUrl?: string;
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly tokenType: 'bearer' | 'token' = 'bearer',
    private readonly options: GitHubClientOptions = {},
  ) {}

  async request<T>(
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<GitHubResponse<T>> {
    const base = this.options.baseUrl ?? GITHUB_API_BASE;
    const url = path.startsWith('http') ? path : `${base}${path}`;
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `${this.tokenType === 'bearer' ? 'Bearer' : 'token'} ${this.token}`,
        'user-agent': this.options.userAgent ?? 'repo-wrangler',
        'x-github-api-version': GITHUB_API_VERSION,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    const rateLimit: RateLimitInfo = {
      remaining: numberHeader(response, 'x-ratelimit-remaining'),
      reset: numberHeader(response, 'x-ratelimit-reset'),
      used: numberHeader(response, 'x-ratelimit-used'),
    };

    let data: T | undefined;
    if (response.status !== 204) {
      try {
        data = (await response.json()) as T;
      } catch {
        data = undefined;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      rateLimit,
      link: response.headers.get('link') ?? undefined,
    };
  }
}

function numberHeader(response: Response, name: string): number | undefined {
  const value = response.headers.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** True when the Link header advertises another page. */
export function hasNextPage(link: string | undefined): boolean {
  return link !== undefined && link.includes('rel="next"');
}
