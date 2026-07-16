/**
 * Onboarding design Phase A1 — admin write API for estate scope
 * (`PATCH /workspaces/:id`, `PATCH /repositories/:id`). Runs the real router
 * against an in-memory SQLite-backed D1 handle; a small wrapper app stands in
 * for `requireAuth` so tests can set the session directly (Phase A does not
 * touch the session layer).
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import {
  ensureGitHubConnection,
  getWorkspaceMonitoringState,
  listAuditEvents,
  upsertRepository,
  upsertWorkspace,
} from '@repo-wrangler/persistence-d1';
import { apiRoutes } from '../src/api/routes';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');

/** DEMO_MODE=false forces real mode regardless of provider configuration. */
function realEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {}, DEMO_MODE: 'false' } as unknown as Env;
}

function demoEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} } as unknown as Env;
}

/** Stands in for `requireAuth` by setting the session directly. */
function testApp(user: SessionUserDto | null) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.route('/api/v1', apiRoutes);
  return app;
}

const admin: SessionUserDto = { login: 'operator', role: 'admin' };
const viewer: SessionUserDto = { login: 'guest', role: 'viewer' };

describe('PATCH /api/v1/workspaces/:id and /repositories/:id — A1', () => {
  let db: D1Database;
  let workspaceId: string;
  let repositoryId: string;

  beforeEach(async () => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
    const connectionId = await ensureGitHubConnection(db);
    workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    repositoryId = await upsertRepository(db, workspaceId, makeRepositorySnapshot());
  });

  it('403s a viewer session', async () => {
    const res = await testApp(viewer).request(
      `/api/v1/workspaces/${workspaceId}`,
      { method: 'PATCH', body: JSON.stringify({ monitoring_state: 'ignored' }) },
      realEnv(db),
    );
    expect(res.status).toBe(403);
  });

  it('409s in demo mode, even for an admin', async () => {
    const res = await testApp(admin).request(
      `/api/v1/workspaces/${workspaceId}`,
      { method: 'PATCH', body: JSON.stringify({ monitoring_state: 'ignored' }) },
      demoEnv(db),
    );
    expect(res.status).toBe(409);
  });

  it('400s an invalid monitoring_state value', async () => {
    const res = await testApp(admin).request(
      `/api/v1/workspaces/${workspaceId}`,
      { method: 'PATCH', body: JSON.stringify({ monitoring_state: 'archived' }) },
      realEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('400s malformed JSON', async () => {
    const res = await testApp(admin).request(
      `/api/v1/workspaces/${workspaceId}`,
      { method: 'PATCH', body: '{not json' },
      realEnv(db),
    );
    expect(res.status).toBe(400);
  });

  it('404s an unknown workspace id', async () => {
    const res = await testApp(admin).request(
      `/api/v1/workspaces/no-such-id`,
      { method: 'PATCH', body: JSON.stringify({ monitoring_state: 'ignored' }) },
      realEnv(db),
    );
    expect(res.status).toBe(404);
  });

  it('200s for an admin, persists the state, and audits the change', async () => {
    const res = await testApp(admin).request(
      `/api/v1/workspaces/${workspaceId}`,
      { method: 'PATCH', body: JSON.stringify({ monitoring_state: 'ignored' }) },
      realEnv(db),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: workspaceId, monitoring_state: 'ignored' });
    expect(await getWorkspaceMonitoringState(db, workspaceId)).toBe('ignored');
    const audit = await listAuditEvents(db);
    expect(audit.some((e) => e.action === 'estate.workspace.ignore')).toBe(true);
  });

  it('200s for an owner on a repository and persists the state', async () => {
    const res = await testApp({ login: 'owner', role: 'owner' }).request(
      `/api/v1/repositories/${repositoryId}`,
      { method: 'PATCH', body: JSON.stringify({ monitoring_state: 'ignored' }) },
      realEnv(db),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: repositoryId, monitoring_state: 'ignored' });
    const audit = await listAuditEvents(db);
    expect(audit.some((e) => e.action === 'estate.repository.ignore')).toBe(true);
  });

  it('404s an unknown repository id', async () => {
    const res = await testApp(admin).request(
      `/api/v1/repositories/no-such-id`,
      { method: 'PATCH', body: JSON.stringify({ monitoring_state: 'ignored' }) },
      realEnv(db),
    );
    expect(res.status).toBe(404);
  });
});
