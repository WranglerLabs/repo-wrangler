import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { ensureGitHubConnection } from '@repo-wrangler/persistence-d1';
import type { Env } from '../src/bindings';
import { writableConnectionSecretProvider } from '../src/lib/connection-secrets';
import { authConfig, enabledProviders } from '../src/auth/registry';

const migrationsDir = join(__dirname, '../../../migrations');

let db: D1Database;

beforeEach(() => {
  const { d1, raw } = openSqliteD1(':memory:');
  applyMigrations(raw, migrationsDir);
  db = d1 as unknown as D1Database;
});

afterEach(() => {
  // Nothing to unstub — kept for symmetry with the connections-github suite.
});

/** A minimal Env; only the auth-relevant fields matter for these tests. */
function env(overrides: Partial<Env>): Env {
  return { DB: db, ASSETS: {}, ...overrides } as unknown as Env;
}

/** Persists a github connection's OAuth client creds through the same writable
 * secret provider the wizard's exchange/credentials endpoints use, so a test
 * can assert the sign-in provider resolves DB-stored creds with no env vars set. */
async function storeGitHubOAuthClient(clientId: string, clientSecret: string): Promise<void> {
  const connectionId = await ensureGitHubConnection(db);
  const secrets = await writableConnectionSecretProvider(
    env({ SECRET_ENCRYPTION_KEY: 'test-key' }),
    db,
    connectionId,
  );
  await secrets.set('GITHUB_CLIENT_ID', clientId);
  await secrets.set('GITHUB_CLIENT_SECRET', clientSecret);
}

describe('auth registry — provider selection', () => {
  it('falls back to GitHub when AUTH_MODE/AUTH_PROVIDERS are unset and GitHub is configured', async () => {
    const providers = await enabledProviders(
      env({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' }),
    );
    expect(providers.map((p) => p.id)).toEqual(['github']);
  });

  it('honours legacy AUTH_MODE=entra', async () => {
    const providers = await enabledProviders(
      env({
        AUTH_MODE: 'entra',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        ENTRA_CLIENT_SECRET: 's',
      }),
    );
    expect(providers.map((p) => p.id)).toEqual(['entra']);
  });

  it('enables multiple providers in the order AUTH_PROVIDERS lists them', async () => {
    const providers = await enabledProviders(
      env({
        AUTH_PROVIDERS: 'entra,github',
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        ENTRA_CLIENT_SECRET: 's',
      }),
    );
    expect(providers.map((p) => p.id)).toEqual(['entra', 'github']);
  });

  it('drops an enabled-but-unconfigured provider', async () => {
    const providers = await enabledProviders(
      env({ AUTH_PROVIDERS: 'github,google', GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' }),
    );
    // google has no client id/secret, so it is filtered out.
    expect(providers.map((p) => p.id)).toEqual(['github']);
  });

  it('never enables local-dev via the AUTH_MODE fallback', async () => {
    const providers = await enabledProviders(env({ LOCAL_DEV_USERS: 'dev' }));
    expect(providers.map((p) => p.id)).not.toContain('local');
  });

  it('enables local-dev only when explicitly listed and allowlisted', async () => {
    const providers = await enabledProviders(
      env({ AUTH_PROVIDERS: 'local', LOCAL_DEV_USERS: 'dev,other' }),
    );
    expect(providers.map((p) => p.id)).toEqual(['local']);
  });

  it('exposes GitLab and Google when configured', async () => {
    const providers = await enabledProviders(
      env({
        AUTH_PROVIDERS: 'gitlab,google',
        GITLAB_CLIENT_ID: 'g',
        GITLAB_CLIENT_SECRET: 'gs',
        GOOGLE_CLIENT_ID: 'go',
        GOOGLE_CLIENT_SECRET: 'gos',
      }),
    );
    expect(providers.map((p) => p.id)).toEqual(['gitlab', 'google']);
  });

  it('exposes GitHub when its OAuth client creds live only in the DB store (no env vars)', async () => {
    await storeGitHubOAuthClient('db-client-id', 'db-client-secret');
    const providers = await enabledProviders(env({ SECRET_ENCRYPTION_KEY: 'test-key' }));
    expect(providers.map((p) => p.id)).toEqual(['github']);
  });

  it('drops GitHub when neither the DB store nor env has OAuth client creds', async () => {
    await ensureGitHubConnection(db);
    const providers = await enabledProviders(env({ SECRET_ENCRYPTION_KEY: 'test-key' }));
    expect(providers.map((p) => p.id)).not.toContain('github');
  });
});

describe('authConfig — SPA sign-in payload', () => {
  it('returns one login button per enabled provider with its URL', async () => {
    const cfg = await authConfig(
      env({
        AUTH_PROVIDERS: 'github,entra',
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        ENTRA_CLIENT_SECRET: 's',
        DEMO_MODE: 'true',
      }),
    );
    expect(cfg.demo).toBe(true);
    expect(cfg.providers).toEqual([
      { id: 'github', label: 'GitHub', loginUrl: '/auth/github/login' },
      { id: 'entra', label: 'Microsoft', loginUrl: '/auth/entra/login' },
    ]);
  });

  it('lists GitHub via its DB-stored OAuth client creds with no env vars set', async () => {
    await storeGitHubOAuthClient('db-client-id', 'db-client-secret');
    const cfg = await authConfig(env({ SECRET_ENCRYPTION_KEY: 'test-key' }));
    expect(cfg.providers).toEqual([
      { id: 'github', label: 'GitHub', loginUrl: '/auth/github/login' },
    ]);
  });
});
