/**
 * GitHub sign-in wired to wizard-stored creds (ADR-019, PN-5). Mirrors the
 * DB-fixture pattern in connections-github.test.ts: a real in-memory D1 so
 * `resolveGitHubOAuthClient` (db-first, env-fallback) exercises its actual
 * query path rather than a stub.
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { ensureGitHubConnection } from '@repo-wrangler/persistence-d1';
import { authRoutes } from '../src/auth/github';
import { writableConnectionSecretProvider } from '../src/lib/connection-secrets';
import { resolveGitHubAllowedUsers, storeGitHubIdentity } from '../src/lib/identity-secrets';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');

function testApp() {
  const app = new Hono<AppContext>();
  app.route('/auth', authRoutes);
  return app;
}

function env(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: {},
    SESSION_SECRET: 'session-secret',
    DEMO_MODE: 'false',
    ...overrides,
  } as unknown as Env;
}

describe('GitHub sign-in — DB-first, env-fallback OAuth client creds', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('redirects with the DB-stored client_id when creds live only in the db store', async () => {
    const connectionId = await ensureGitHubConnection(db);
    const secrets = await writableConnectionSecretProvider(
      env(db, { SECRET_ENCRYPTION_KEY: 'test-key' }),
      db,
      connectionId,
    );
    await secrets.set('GITHUB_CLIENT_ID', 'db-client-id');
    await secrets.set('GITHUB_CLIENT_SECRET', 'db-client-secret');

    const res = await testApp().request(
      '/auth/github/login',
      {},
      env(db, { SECRET_ENCRYPTION_KEY: 'test-key' }),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('db-client-id');
  });

  it('still redirects using env vars when no connection is stored (env-fallback)', async () => {
    const res = await testApp().request(
      '/auth/github/login',
      {},
      env(db, { GITHUB_CLIENT_ID: 'env-client-id', GITHUB_CLIENT_SECRET: 'env-client-secret' }),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('client_id')).toBe('env-client-id');
  });

  it('500s when neither the db store nor env has GitHub OAuth client creds', async () => {
    const res = await testApp().request('/auth/github/login', {}, env(db));
    expect(res.status).toBe(500);
  });

  it('resolves the encrypted wizard administrator list before the env fallback', async () => {
    const configuredEnv = env(db, {
      SECRET_ENCRYPTION_KEY: 'test-key',
      ALLOWED_GITHUB_USERS: 'env-owner',
    });
    await storeGitHubIdentity(configuredEnv, 'wizard-owner,wizard-admin');
    expect(await resolveGitHubAllowedUsers(configuredEnv)).toBe('wizard-owner,wizard-admin');
    expect(await resolveGitHubAllowedUsers(env(db, { ALLOWED_GITHUB_USERS: 'env-owner' }))).toBe('env-owner');
  });
});
