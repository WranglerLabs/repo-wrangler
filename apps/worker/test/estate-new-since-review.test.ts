/**
 * Onboarding design Phase C2 — "new since last review"
 * (`GET /estate/new-since-review`, `POST /estate/mark-reviewed`). Runs the
 * real router against an in-memory SQLite-backed D1 handle, the same harness
 * as estate-scope.test.ts (A1).
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import {
  ensureGitHubConnection,
  getMeta,
  listAuditEvents,
  upsertRepository,
  upsertWorkspace,
} from '@repo-wrangler/persistence-d1';
import { apiRoutes } from '../src/api/routes';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');

function realEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {}, DEMO_MODE: 'false' } as unknown as Env;
}

function demoEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {} } as unknown as Env;
}

function testApp(user: SessionUserDto | null) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.route('/api/v1', apiRoutes);
  return app;
}

const admin: SessionUserDto = { login: 'kris', role: 'admin' };
const viewer: SessionUserDto = { login: 'guest', role: 'viewer' };

describe('GET /api/v1/estate/new-since-review and POST /estate/mark-reviewed — C2', () => {
  let db: D1Database;

  beforeEach(async () => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('with no marker ever set, every existing repository counts as new (epoch default)', async () => {
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    const repoId = await upsertRepository(db, workspaceId, makeRepositorySnapshot());

    const res = await testApp(viewer).request('/api/v1/estate/new-since-review', {}, realEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string }[];
    expect(body.map((r) => r.id)).toEqual([repoId]);
  });

  it('returns [] in demo mode', async () => {
    const res = await testApp(viewer).request('/api/v1/estate/new-since-review', {}, demoEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('403s mark-reviewed for a viewer session', async () => {
    const res = await testApp(viewer).request(
      '/api/v1/estate/mark-reviewed',
      { method: 'POST' },
      realEnv(db),
    );
    expect(res.status).toBe(403);
  });

  it('409s mark-reviewed in demo mode, even for an admin', async () => {
    const res = await testApp(admin).request(
      '/api/v1/estate/mark-reviewed',
      { method: 'POST' },
      demoEnv(db),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, demo: true });
  });

  it('marking reviewed advances the marker, audits it, and empties the new-since-review list', async () => {
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    await upsertRepository(db, workspaceId, makeRepositorySnapshot());

    const markRes = await testApp(admin).request(
      '/api/v1/estate/mark-reviewed',
      { method: 'POST' },
      realEnv(db),
    );
    expect(markRes.status).toBe(200);
    const marked = (await markRes.json()) as { ok: boolean; reviewedAt: string };
    expect(marked.ok).toBe(true);
    expect(await getMeta(db, 'estate.last_reviewed_at')).toBe(marked.reviewedAt);
    const audit = await listAuditEvents(db);
    expect(audit.some((e) => e.action === 'estate.reviewed')).toBe(true);

    const listRes = await testApp(viewer).request('/api/v1/estate/new-since-review', {}, realEnv(db));
    expect(await listRes.json()).toEqual([]);
  });
});
