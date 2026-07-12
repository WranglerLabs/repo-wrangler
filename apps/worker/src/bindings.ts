export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  // Secrets (wrangler secret put …)
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  GITLAB_TOKEN?: string;
  GITLAB_WEBHOOK_SECRET?: string;

  // Non-secret configuration (wrangler.jsonc vars / dashboard)
  AUTH_MODE?: string;
  DEMO_MODE?: string;
  PUBLIC_BASE_URL?: string;
  ALLOWED_GITHUB_USERS?: string;
  ALLOWED_GITHUB_ORGS?: string;
  DEFAULT_RETENTION_DAYS?: string;
  /**
   * Comma-separated exact SPA origins allowed to call the API cross-origin
   * (ADR-011, Mode B — decoupled frontend). Empty/unset (default, Mode A) means
   * same-origin only: no cross-origin access is granted.
   */
  CORS_ALLOWED_ORIGINS?: string;
  /** GitLab base URL for self-managed instances; defaults to gitlab.com. */
  GITLAB_BASE_URL?: string;
  /** Comma-separated top-level GitLab group paths to monitor. */
  GITLAB_GROUPS?: string;
  /** Optional outbound webhook for critical/high attention escalations. */
  NOTIFY_WEBHOOK_URL?: string;
}

export const APP_VERSION = '0.3.0';

export function isGitLabConfigured(env: Env): boolean {
  return Boolean(env.GITLAB_TOKEN && env.GITLAB_GROUPS);
}

/** Parsed CORS allowlist (ADR-011). Empty array ⇒ same-origin only. */
export function corsAllowedOrigins(env: Env): string[] {
  return (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function isDemoMode(env: Env): boolean {
  if (env.DEMO_MODE === 'true') return true;
  // Fall back to demo mode when no GitHub App is configured, so a fresh
  // deployment shows a working product instead of an error page.
  return !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY;
}
