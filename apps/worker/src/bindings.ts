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

  // Non-secret configuration (wrangler.jsonc vars / dashboard)
  AUTH_MODE?: string;
  DEMO_MODE?: string;
  PUBLIC_BASE_URL?: string;
  ALLOWED_GITHUB_USERS?: string;
  ALLOWED_GITHUB_ORGS?: string;
  DEFAULT_RETENTION_DAYS?: string;
}

export const APP_VERSION = '0.1.0';

export function isDemoMode(env: Env): boolean {
  if (env.DEMO_MODE === 'true') return true;
  // Fall back to demo mode when no GitHub App is configured, so a fresh
  // deployment shows a working product instead of an error page.
  return !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY;
}
