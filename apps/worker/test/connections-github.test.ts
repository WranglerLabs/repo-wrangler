/**
 * Onboarding design B3 — GitHub connect API. The manifest-exchange path uses
 * a raw `fetch` to GitHub's conversions endpoint (mocked here); the
 * paste-credentials path and `GET /connections/:id/workspaces` are exercised
 * against a mocked `@repo-wrangler/provider-github` (no real RSA signing
 * needed — that module's own tests cover JWT creation).
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { getConnectionByType, listAuditEvents, listConnections } from '@repo-wrangler/persistence-d1';
import { connectionRoutes } from '../src/api/connections';
import { resolveGitHubAppCredentials } from '../src/lib/connection-secrets';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');

const mocks = vi.hoisted(() => ({
  listInstallations: vi.fn(),
  getInstallationToken: vi.fn(),
  listInstallationRepositories: vi.fn(),
}));

vi.mock('@repo-wrangler/provider-github', async () => {
  const actual = await vi.importActual<typeof import('@repo-wrangler/provider-github')>(
    '@repo-wrangler/provider-github',
  );
  return {
    ...actual,
    listInstallations: mocks.listInstallations,
    getInstallationToken: mocks.getInstallationToken,
    listInstallationRepositories: mocks.listInstallationRepositories,
  };
});

const admin: SessionUserDto = { login: 'kris', role: 'admin' };
const viewer: SessionUserDto = { login: 'guest', role: 'viewer' };

function testApp(user: SessionUserDto | null) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.route('/api/v1', connectionRoutes);
  return app;
}

function realEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return { DB: db, ASSETS: {}, DEMO_MODE: 'false', SECRET_ENCRYPTION_KEY: 'test-key', ...overrides } as unknown as Env;
}

function demoEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} } as unknown as Env;
}

describe('POST /api/v1/connections/github/exchange — B3', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('403s a viewer session', async () => {
    const res = await testApp(viewer).request(
      '/api/v1/connections/github/exchange',
      { method: 'POST', body: JSON.stringify({ code: 'abc' }) },
      realEnv(db),
    );
    expect(res.status).toBe(403);
  });

  it('409s in demo mode', async () => {
    const res = await testApp(admin).request(
      '/api/v1/connections/github/exchange',
      { method: 'POST', body: JSON.stringify({ code: 'abc' }) },
      demoEnv(db),
    );
    expect(res.status).toBe(409);
  });

  it('400s a missing code', async () => {
    const res = await testApp(admin).request(
      '/api/v1/connections/github/exchange',
      { method: 'POST', body: JSON.stringify({}) },
      realEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('exchanges the setup code, stores credentials, and creates a connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 987654,
            slug: 'repowrangler-acme',
            pem: '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----',
            webhook_secret: 'whsec-1',
            client_id: 'client-1',
            client_secret: 'client-secret-1',
          }),
          { status: 200 },
        ),
      ),
    );

    const res = await testApp(admin).request(
      '/api/v1/connections/github/exchange',
      { method: 'POST', body: JSON.stringify({ code: 'one-time-code' }) },
      realEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      appSlug: 'repowrangler-acme',
      installUrl: 'https://github.com/apps/repowrangler-acme/installations/new',
    });
    expect(body.connectionId).toBeTruthy();

    // The exact "no restart" requirement (Credential entry test plan #3):
    // the connection's credentials resolve straight from the DB store.
    const credentials = await resolveGitHubAppCredentials(realEnv(db), db);
    expect(credentials).toMatchObject({
      appId: '987654',
      privateKey: '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----',
      webhookSecret: 'whsec-1',
      clientId: 'client-1',
      clientSecret: 'client-secret-1',
    });

    const audit = await listAuditEvents(db);
    expect(audit.some((e) => e.action === 'connection.github.created')).toBe(true);
  });

  it('surfaces a clean error and stores nothing when GitHub rejects the code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));

    const res = await testApp(admin).request(
      '/api/v1/connections/github/exchange',
      { method: 'POST', body: JSON.stringify({ code: 'expired-code' }) },
      realEnv(db),
    );
    expect(res.status).toBe(400);
    expect(await getConnectionByType(db, 'github')).toBeNull();
    expect(await listConnections(db)).toHaveLength(0);
  });
});

describe('POST /api/v1/connections/github/credentials — B3 paste path', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('400s when required fields are missing', async () => {
    const res = await testApp(admin).request(
      '/api/v1/connections/github/credentials',
      { method: 'POST', body: JSON.stringify({ appId: '1' }) },
      realEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('500s a clean error when SECRET_ENCRYPTION_KEY is not configured', async () => {
    const res = await testApp(admin).request(
      '/api/v1/connections/github/credentials',
      {
        method: 'POST',
        body: JSON.stringify({ appId: '1', privateKey: 'pem', webhookSecret: 'whsec' }),
      },
      realEnv(db, { SECRET_ENCRYPTION_KEY: undefined }),
    );
    expect(res.status).toBe(500);
  });

  it('stores pasted credentials and they resolve on the next job', async () => {
    const res = await testApp(admin).request(
      '/api/v1/connections/github/credentials',
      {
        method: 'POST',
        body: JSON.stringify({
          appId: '42',
          privateKey: '-----BEGIN PRIVATE KEY-----xyz-----END PRIVATE KEY-----',
          webhookSecret: 'whsec-2',
        }),
      },
      realEnv(db),
    );
    expect(res.status).toBe(200);
    const credentials = await resolveGitHubAppCredentials(realEnv(db), db);
    expect(credentials?.appId).toBe('42');
    expect(credentials?.clientId).toBeUndefined();
  });
});

describe('GET /api/v1/connections/:id/workspaces — GitHub branch', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
    mocks.listInstallations.mockReset();
    mocks.getInstallationToken.mockReset();
    mocks.listInstallationRepositories.mockReset();
  });

  it('404s an unknown connection id', async () => {
    const res = await testApp(admin).request('/api/v1/connections/no-such-id/workspaces', {}, realEnv(db));
    expect(res.status).toBe(404);
  });

  it('discovers installations, upserts them as workspaces, and reports repo counts', async () => {
    const res1 = await testApp(admin).request(
      '/api/v1/connections/github/credentials',
      {
        method: 'POST',
        body: JSON.stringify({ appId: '1', privateKey: 'pem', webhookSecret: 'whsec' }),
      },
      realEnv(db),
    );
    const { connectionId } = await res1.json();

    mocks.listInstallations.mockResolvedValue([
      { id: 111, account: { id: 5001, login: 'acme-labs', type: 'Organization' } },
    ]);
    mocks.getInstallationToken.mockResolvedValue('inst-token');
    mocks.listInstallationRepositories.mockResolvedValue({
      repositories: [],
      totalCount: 42,
    });

    const res = await testApp(admin).request(
      `/api/v1/connections/${connectionId}/workspaces`,
      {},
      realEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: expect.any(String),
        slug: 'acme-labs',
        displayName: 'acme-labs',
        kind: 'organization',
        monitoringState: 'monitored',
        repoCount: 42,
      },
    ]);
  });
});
