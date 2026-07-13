/**
 * Server configuration and the Cloudflare-shaped `Env` construction for the
 * Node host.
 *
 * The shared Hono app (`@repo-wrangler/worker`) is written against a Cloudflare
 * `Env` — a `DB` binding, an `ASSETS` fetcher, and a flat bag of string config.
 * On Cloudflare those come from wrangler bindings; here they come from a SQLite
 * handle, a static-file fetcher, and `process.env`. Building the same `Env`
 * shape is the whole portability trick (design Portability section, ADR-013):
 * the app, providers, domain, and API run unchanged.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Env } from '@repo-wrangler/worker';

/** Resolved server runtime configuration. */
export interface ServerConfig {
  /** TCP port the HTTP server listens on. */
  port: number;
  /** SQLite database file location (created if absent). Used when no `databaseUrl`. */
  sqlitePath: string;
  /**
   * PostgreSQL connection string. When set, PostgreSQL is used instead of the
   * embedded SQLite file — the shared, multi-replica storage option (PN-1).
   */
  databaseUrl?: string;
  /** Directory of ordered `*.sql` migrations to apply at boot. */
  migrationsDir: string;
  /** Directory of the built SPA (`apps/web/dist`) served for non-API routes. */
  webDist: string;
  /** When false, no in-process cron runs (e.g. a separate scheduler replica). */
  enableScheduler: boolean;
}

/** Repository root, resolved from this file (`apps/server/src/env.ts` → up 3). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

/** Read runtime configuration from the environment, with sane defaults. */
export function loadConfig(): ServerConfig {
  const root = repoRoot();
  return {
    port: Number(process.env.PORT ?? '8080'),
    sqlitePath: process.env.SQLITE_PATH ?? resolve(root, 'data', 'repo-wrangler.db'),
    databaseUrl: process.env.DATABASE_URL || undefined,
    migrationsDir: process.env.MIGRATIONS_DIR ?? resolve(root, 'migrations'),
    webDist: process.env.WEB_DIST ?? resolve(root, 'apps', 'web', 'dist'),
    enableScheduler: bool(process.env.ENABLE_SCHEDULER, true),
  };
}

/**
 * Build the Cloudflare-shaped `Env` the Hono app expects. `DB` is the
 * SQLite-over-D1 adapter; `ASSETS` serves the SPA; every other field is a
 * string pulled straight from `process.env` (secrets and non-secret config
 * alike — identical to how wrangler surfaces vars and secrets).
 */
export function buildEnv(db: D1Database, assets: Fetcher): Env {
  const e = process.env;
  return {
    DB: db,
    ASSETS: assets,

    // Secrets
    GITHUB_APP_ID: e.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: e.GITHUB_APP_PRIVATE_KEY,
    GITHUB_WEBHOOK_SECRET: e.GITHUB_WEBHOOK_SECRET,
    GITHUB_CLIENT_ID: e.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: e.GITHUB_CLIENT_SECRET,
    SESSION_SECRET: e.SESSION_SECRET,
    GITLAB_TOKEN: e.GITLAB_TOKEN,
    GITLAB_WEBHOOK_SECRET: e.GITLAB_WEBHOOK_SECRET,
    ENTRA_CLIENT_SECRET: e.ENTRA_CLIENT_SECRET,

    // Non-secret configuration
    AUTH_MODE: e.AUTH_MODE,
    ENTRA_TENANT_ID: e.ENTRA_TENANT_ID,
    ENTRA_CLIENT_ID: e.ENTRA_CLIENT_ID,
    ENTRA_ALLOWED_USERS: e.ENTRA_ALLOWED_USERS,
    DEMO_MODE: e.DEMO_MODE,
    PUBLIC_BASE_URL: e.PUBLIC_BASE_URL,
    ALLOWED_GITHUB_USERS: e.ALLOWED_GITHUB_USERS,
    ALLOWED_GITHUB_ORGS: e.ALLOWED_GITHUB_ORGS,
    DEFAULT_RETENTION_DAYS: e.DEFAULT_RETENTION_DAYS,
    CORS_ALLOWED_ORIGINS: e.CORS_ALLOWED_ORIGINS,
    GITLAB_BASE_URL: e.GITLAB_BASE_URL,
    GITLAB_GROUPS: e.GITLAB_GROUPS,
    NOTIFY_WEBHOOK_URL: e.NOTIFY_WEBHOOK_URL,
  };
}
