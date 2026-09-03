import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { ensureGitHubConnection, upsertWorkspace } from '@repo-wrangler/persistence-d1';
import { makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import { apiRoutes } from '../src/api/routes';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');
const admin: SessionUserDto = { login: 'operator', role: 'admin' };

function app() {
  const instance = new Hono<AppContext>();
  instance.use('*', async (c, next) => {
    c.set('user', admin);
    await next();
  });
  instance.route('/api/v1', apiRoutes);
  return instance;
}

describe('Administration Operations API', () => {
  it('distinguishes queue states, returns summaries, and retries failed work', async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    const db = opened.d1 as unknown as D1Database;
    const env = { DB: db, ASSETS: {}, DEMO_MODE: 'false' } as unknown as Env;
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    await db.prepare(
      `INSERT INTO sync_jobs
         (id, job_type, priority, scope, state, attempts, subrequests_used, created_at, started_at, finished_at, last_error)
       VALUES
         ('pending', 'discovery', 3, ?1, 'pending', 0, 0, '2026-09-03 00:00:00', NULL, NULL, NULL),
         ('running', 'billing', 8, ?1, 'running', 1, 4, '2026-09-03 00:01:00', '2026-09-03 00:02:00', NULL, NULL),
         ('complete', 'discovery', 3, ?1, 'done', 1, 7, '2026-09-03 00:03:00', '2026-09-03 00:04:00', '2026-09-03 00:05:00', NULL),
         ('failed', 'billing', 8, ?1, 'failed', 5, 3, '2026-09-03 00:06:00', '2026-09-03 00:07:00', '2026-09-03 00:08:00', 'provider denied access')`,
    ).bind(connectionId).run();
    await db.prepare(
      `INSERT INTO operation_runs
         (id, job_id, operation_type, connection_id, status, correlation_id, result_summary, error_code)
       VALUES
         ('complete', 'complete', 'discovery', ?1, 'completed', 'correlation-complete',
          '{"repositoriesMoved":2,"noChange":false}', NULL),
         ('failed', 'failed', 'billing', ?1, 'failed', 'correlation-failed', NULL, 'not_authorized')`,
    ).bind(connectionId).run();
    await db.prepare(
      `INSERT INTO usage_imports
         (id, job_id, connection_id, workspace_id, period_start, period_end, status,
          correlation_id, rows_imported, error_code, error_detail, retry_eligible)
       VALUES ('usage-failed', 'failed', ?1, ?2, '2026-09-01', '2026-09-30', 'failed',
         'usage-correlation', 0, 'not_authorized', 'Administration read is required', 1)`,
    ).bind(connectionId, workspaceId).run();

    const response = await app().request('/api/v1/admin/operations', {}, env);
    expect(response.status).toBe(200);
    const operations = await response.json() as Array<Record<string, unknown>>;
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pending', state: 'pending' }),
      expect.objectContaining({ id: 'running', state: 'running' }),
      expect.objectContaining({
        id: 'complete', state: 'completed', correlationId: 'correlation-complete',
        resultSummary: { repositoriesMoved: 2, noChange: false },
      }),
      expect.objectContaining({
        id: 'failed', state: 'failed', retryEligible: true, errorCode: 'not_authorized',
      }),
      expect.objectContaining({
        id: 'usage-failed', type: 'usage_import', state: 'failed', retryEligible: true,
        errorCode: 'not_authorized', resultSummary: { rowsImported: 0 },
      }),
    ]));

    const retry = await app().request(
      '/api/v1/admin/operations/failed/retry', { method: 'POST' }, env,
    );
    expect(retry.status).toBe(200);
    expect(await db.prepare(`SELECT state, last_error FROM sync_jobs WHERE id = 'failed'`).first())
      .toEqual({ state: 'failed', last_error: 'provider denied access' });
    expect(await db.prepare(
      `SELECT COUNT(*) AS count FROM sync_jobs
       WHERE job_type = 'billing' AND scope = ?1 AND state = 'pending'`,
    ).bind(connectionId).first()).toEqual({ count: 1 });

    const retryImport = await app().request(
      '/api/v1/admin/operations/usage-failed/retry', { method: 'POST' }, env,
    );
    expect(retryImport.status).toBe(200);
    expect(await db.prepare(
      `SELECT job_type, scope, state FROM sync_jobs
       WHERE job_type = 'billing' AND scope = ?1 AND state = 'pending'`,
    ).bind(connectionId).first()).toEqual({
      job_type: 'billing', scope: connectionId, state: 'pending',
    });
  });
});
