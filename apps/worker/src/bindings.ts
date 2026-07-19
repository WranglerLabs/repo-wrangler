import rootPackage from '../../../package.json';

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
  /** Optional first-boot bearer used only while no real sign-in provider is configured. */
  SETUP_TOKEN?: string;
  GITLAB_TOKEN?: string;
  GITLAB_WEBHOOK_SECRET?: string;
  /** GitLab OAuth application id/secret — used by the GitLab sign-in provider. */
  GITLAB_CLIENT_ID?: string;
  GITLAB_CLIENT_SECRET?: string;
  /** Microsoft Entra ID (Azure AD) app client secret — used by the Entra provider. */
  ENTRA_CLIENT_SECRET?: string;
  /** Google OAuth 2.0 / OIDC client id/secret — used by the Google sign-in provider. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Shared bearer token authorizing the external-tick cron endpoint (PN-3). */
  CRON_TRIGGER_TOKEN?: string;
  /**
   * Encryption key for the `db` writable secret backend (ADR-021, onboarding
   * design "Credential entry") — an infrastructure secret like `SESSION_SECRET`,
   * resolved at boot. Provider credentials entered through the onboarding
   * wizard are encrypted at rest with a key derived from this value; losing it
   * means losing those credentials (a documented backup obligation).
   */
  SECRET_ENCRYPTION_KEY?: string;

  // Non-secret configuration (wrangler.jsonc vars / dashboard)
  /**
   * Legacy single sign-in selector: `github_app` (default) or `entra`. Superseded
   * by `AUTH_PROVIDERS` (ADR-019); still honoured when `AUTH_PROVIDERS` is unset.
   */
  AUTH_MODE?: string;
  /**
   * Comma-separated ordered list of enabled sign-in providers — any of
   * `github`, `gitlab`, `entra`, `google`, `local` (ADR-019, PN-5). When set it
   * takes precedence over `AUTH_MODE`; a provider only appears if it is also
   * configured. Empty/unset falls back to `AUTH_MODE`.
   */
  AUTH_PROVIDERS?: string;
  /** Entra directory (tenant) ID, or `organizations`/`common`. */
  ENTRA_TENANT_ID?: string;
  /** Entra application (client) ID. */
  ENTRA_CLIENT_ID?: string;
  /**
   * Comma-separated Entra sign-in names (UPN/email) allowed to sign in; the
   * first to sign in becomes the owner, the rest are admins. Empty = nobody.
   */
  ENTRA_ALLOWED_USERS?: string;
  /** Comma-separated GitLab usernames allowed to sign in (first = owner). */
  GITLAB_ALLOWED_USERS?: string;
  /** Comma-separated Google account emails allowed to sign in (first = owner). */
  GOOGLE_ALLOWED_USERS?: string;
  /**
   * Comma-separated usernames for the local-dev sign-in provider (first = owner).
   * Intended only for local development / evaluation; never enable in production.
   */
  LOCAL_DEV_USERS?: string;
  /**
   * Scheduler driver for a self-hosted host (PN-3): `in-process` (default — an
   * internal timer), `external` (no timer; an external ticker POSTs
   * `/internal/cron/run`), or `off` (no scheduling). Ignored on Cloudflare, where
   * cron triggers always call the `scheduled` handler.
   */
  SCHEDULER_MODE?: string;
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
  /** Runtime release identifier; container builds set this from their image tag. */
  APP_VERSION?: string;
}

/** Build/package fallback used when the host does not provide APP_VERSION. */
export const BUILD_VERSION = rootPackage.version;

/** Deployed version: runtime/image override first, then the checked-in package version. */
export function appVersion(env: Env): string {
  return env.APP_VERSION?.trim() || BUILD_VERSION;
}

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

/** Configured sign-in provider. Defaults to GitHub App user-authorization. */
export function authMode(env: Env): 'github_app' | 'entra' {
  return env.AUTH_MODE === 'entra' ? 'entra' : 'github_app';
}

/** Resolved scheduler driver for a self-hosted host (PN-3). */
export function schedulerMode(env: Env): 'in-process' | 'external' | 'off' {
  switch ((env.SCHEDULER_MODE ?? '').toLowerCase()) {
    case 'external':
      return 'external';
    case 'off':
      return 'off';
    default:
      return 'in-process';
  }
}

export function isDemoMode(env: Env): boolean {
  if (env.DEMO_MODE === 'true') return true;
  // Explicit opt-out always wins — an operator who set DEMO_MODE=false wants
  // real mode even while providers are still being configured.
  if (env.DEMO_MODE === 'false') return false;
  // Otherwise fall back to demo mode only when NO provider is configured, so a
  // fresh deployment shows a working product instead of an error page. A
  // GitLab-only deployment (token + groups, no GitHub App) is real, not demo.
  const hasGitHub = Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
  const hasGitLab = Boolean(env.GITLAB_TOKEN && env.GITLAB_GROUPS);
  return !hasGitHub && !hasGitLab;
}
