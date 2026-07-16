/**
 * B12 — `billing` was enqueued in exactly one place, `runDailyMaintenance`,
 * gated on the literal '17 3 * * *' cron tick (scheduled/index.ts). An
 * instance that is never alive across 03:17 UTC never ran a billing sync, so
 * Budgets & Usage stayed empty forever — same class of bug as B3b's
 * discovery→enrichment gap. Fix: `ensurePeriodicJobs` also enqueues billing
 * roughly daily off the ordinary periodic tick (mirroring the existing
 * `last_discovery_enqueued_at` gate), and admin "Sync now" enqueues billing
 * alongside discovery so an operator can force it.
 *
 * `ensurePeriodicJobs` is tested directly (not via `runScheduled`) — it only
 * enqueues, never claims/runs a job, so this avoids the same-tick
 * job-draining hazard noted on `runDiscovery`/`runGitLabDiscovery`
 * (discovery-enrichment-chaining.test.ts).
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { getMeta } from '@repo-wrangler/persistence-d1';
import { apiRoutes } from '../src/api/routes';
import { ensurePeriodicJobs } from '../src/scheduled/index';
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

async function pendingJobScopes(db: D1Database, jobType: string): Promise<string[]> {
  const result = await db
    .prepare(`SELECT scope FROM sync_jobs WHERE job_type = ?1 AND state = 'pending'`)
    .bind(jobType)
    .all<{ scope: string }>();
  return result.results.map((r) => r.scope);
}

describe('ensurePeriodicJobs — billing gate (B12)', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('enqueues billing on the periodic tick when the gate meta is absent', async () => {
    await ensurePeriodicJobs(realEnv(db));
    expect(await pendingJobScopes(db, 'billing')).toEqual(['all']);
    expect(await getMeta(db, 'last_billing_enqueued_at')).toBeTruthy();
  });

  it('does not re-enqueue billing within the daily window', async () => {
    await ensurePeriodicJobs(realEnv(db));
    expect(await pendingJobScopes(db, 'billing')).toHaveLength(1);

    // A second periodic tick moments later (e.g. the next 5-minute scheduler
    // pass) must not pile up a second pending billing job — the meta gate
    // just stamped is still fresh.
    await ensurePeriodicJobs(realEnv(db));
    expect(await pendingJobScopes(db, 'billing')).toHaveLength(1);
  });

  it('does not enqueue billing in demo mode', async () => {
    await ensurePeriodicJobs(demoEnv(db));
    expect(await pendingJobScopes(db, 'billing')).toEqual([]);
  });
});

describe('POST /api/v1/admin/sync — enqueues billing alongside discovery (B12)', () => {
  let db: D1Database;
  const admin: SessionUserDto = { login: 'operator', role: 'admin' };

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

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

  it('enqueues both discovery and billing', async () => {
    const res = await testApp(admin).request('/api/v1/admin/sync', { method: 'POST' }, realEnv(db));
    expect(res.status).toBe(200);
    expect(await pendingJobScopes(db, 'discovery')).toEqual(['all']);
    expect(await pendingJobScopes(db, 'billing')).toEqual(['all']);
  });

  it('does nothing in demo mode', async () => {
    const res = await testApp(admin).request('/api/v1/admin/sync', { method: 'POST' }, demoEnv(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, demo: true });
    expect(await pendingJobScopes(db, 'billing')).toEqual([]);
  });
});
