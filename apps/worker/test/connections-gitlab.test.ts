/**
 * Onboarding design B3 — GitLab connect API: token validation, the group
 * search proxy (token never leaves the server), and creating monitored
 * workspace rows for the selected groups.
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { getSyncStats, listAuditEvents, listWorkspacesForConnection } from '@repo-wrangler/persistence-d1';
import { connectionRoutes } from '../src/api/connections';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');
const admin: SessionUserDto = { login: 'kris', role: 'admin' };

function testApp() {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('user', admin);
    await next();
  });
  app.route('/api/v1', connectionRoutes);
  return app;
}

function realEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {}, DEMO_MODE: 'false', SECRET_ENCRYPTION_KEY: 'test-key' } as unknown as Env;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('POST /api/v1/connections/gitlab — B3', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('400s when token is missing', async () => {
    const res = await testApp().request(
      '/api/v1/connections/gitlab',
      { method: 'POST', body: JSON.stringify({}) },
      realEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('400s when GitLab rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: '401 Unauthorized' }, 401)));
    const res = await testApp().request(
      '/api/v1/connections/gitlab',
      { method: 'POST', body: JSON.stringify({ token: 'bad-token' }) },
      realEnv(db),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('token rejected by GitLab');
  });

  it('a valid token creates the connection and stores it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ username: 'kris' })));
    const res = await testApp().request(
      '/api/v1/connections/gitlab',
      { method: 'POST', body: JSON.stringify({ token: 'glpat-good', baseUrl: 'https://gitlab.example.com' }) },
      realEnv(db),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).connectionId).toBeTruthy();
    const audit = await listAuditEvents(db);
    expect(audit.some((e) => e.action === 'connection.gitlab.created')).toBe(true);

    // Wizard-loop fix: discovery is enqueued on connect, not left to a
    // manual admin/sync click.
    const stats = await getSyncStats(db);
    expect(stats.pendingJobs).toBe(1);
  });
});

describe('GET /api/v1/connections/:id/search-groups and POST .../workspaces', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function connect(): Promise<string> {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ username: 'kris' })));
    const res = await testApp().request(
      '/api/v1/connections/gitlab',
      { method: 'POST', body: JSON.stringify({ token: 'glpat-good' }) },
      realEnv(db),
    );
    return (await res.json()).connectionId;
  }

  it('search-groups proxies to GitLab without leaking the token in the response', async () => {
    const connectionId = await connect();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([{ id: 42, full_path: 'acme-labs', name: 'Acme Labs', projects_count: 7 }]),
      ),
    );
    const res = await testApp().request(
      `/api/v1/connections/${connectionId}/search-groups?q=acme`,
      {},
      realEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ externalId: '42', fullPath: 'acme-labs', name: 'Acme Labs', projectCount: 7 }]);
    expect(JSON.stringify(body)).not.toContain('glpat-good');
  });

  it('creates monitored workspace rows for the selected groups', async () => {
    const connectionId = await connect();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/projects')) return jsonResponse([], 200, { 'x-total': '5' });
        return jsonResponse({ id: 42, full_path: 'acme-labs', name: 'Acme Labs' });
      }),
    );
    const res = await testApp().request(
      `/api/v1/connections/${connectionId}/workspaces`,
      { method: 'POST', body: JSON.stringify({ externalIds: ['acme-labs'] }) },
      realEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: expect.any(String),
        slug: 'acme-labs',
        displayName: 'Acme Labs',
        kind: 'group',
        monitoringState: 'monitored',
        repoCount: 5,
      },
    ]);

    // B4 depends on this: the workspace is now queryable by connection id.
    const persisted = await listWorkspacesForConnection(db, connectionId);
    expect(persisted.map((w) => w.slug)).toEqual(['acme-labs']);
  });

  it('400s when externalIds is empty', async () => {
    const connectionId = await connect();
    const res = await testApp().request(
      `/api/v1/connections/${connectionId}/workspaces`,
      { method: 'POST', body: JSON.stringify({ externalIds: [] }) },
      realEnv(db),
    );
    expect(res.status).toBe(400);
  });
});
