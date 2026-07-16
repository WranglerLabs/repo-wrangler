/**
 * Onboarding design B1 — `GET /api/v1/onboarding/status` computes `firstRun`
 * across demo, real-no-workspaces, and real-with-workspaces (Phase B test plan).
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import { ensureGitHubConnection, upsertRepository, upsertWorkspace } from '@repo-wrangler/persistence-d1';
import { connectionRoutes } from '../src/api/connections';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');
const admin: SessionUserDto = { login: 'operator', role: 'admin' };

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
  return { DB: db, ASSETS: {}, DEMO_MODE: 'false' } as unknown as Env;
}

function demoEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} } as unknown as Env;
}

describe('GET /api/v1/onboarding/status — B1 first-run detection', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('demo: never first-run, everything zeroed', async () => {
    const res = await testApp().request('/api/v1/onboarding/status', {}, demoEnv(db));
    expect(await res.json()).toEqual({
      demo: true,
      setupMode: false,
      setupTokenRequired: false,
      connections: 0,
      monitoredWorkspaces: 0,
      firstRun: false,
    });
  });

  it('real mode, no connections yet: firstRun is true', async () => {
    const res = await testApp().request('/api/v1/onboarding/status', {}, realEnv(db));
    const body = await res.json();
    expect(body).toEqual({
      demo: false,
      setupMode: true,
      setupTokenRequired: false,
      connections: 0,
      monitoredWorkspaces: 0,
      firstRun: true,
    });
  });

  it('real mode, a connection exists but nothing monitored yet: still firstRun', async () => {
    await ensureGitHubConnection(db);
    const res = await testApp().request('/api/v1/onboarding/status', {}, realEnv(db));
    const body = await res.json();
    expect(body).toEqual({
      demo: false,
      setupMode: true,
      setupTokenRequired: false,
      connections: 1,
      monitoredWorkspaces: 0,
      firstRun: true,
    });
  });

  it('real mode with a monitored workspace: firstRun flips false', async () => {
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    await upsertRepository(db, workspaceId, makeRepositorySnapshot());
    const res = await testApp().request('/api/v1/onboarding/status', {}, realEnv(db));
    const body = await res.json();
    expect(body).toEqual({
      demo: false,
      setupMode: true,
      setupTokenRequired: false,
      connections: 1,
      monitoredWorkspaces: 1,
      firstRun: false,
    });
  });
});
