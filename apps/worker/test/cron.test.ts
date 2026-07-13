import { describe, expect, it } from 'vitest';
import type { Env } from '../src/bindings';
import { internalCronRoutes } from '../src/internal/cron';

/**
 * Demo-mode env so the happy path's `runScheduled` returns immediately without
 * touching a database (isDemoMode is true when no GitHub App is configured).
 */
function env(overrides: Partial<Env>): Env {
  return { DB: {}, ASSETS: {}, ...overrides } as unknown as Env;
}

function run(e: Env, headers: Record<string, string> = {}): Promise<Response> {
  return internalCronRoutes.request('/cron/run', { method: 'POST', headers }, e);
}

describe('POST /internal/cron/run — external-tick driver (PN-3)', () => {
  it('404s when the scheduler is not in external mode', async () => {
    const res = await run(env({ CRON_TRIGGER_TOKEN: 'tok' }), { authorization: 'Bearer tok' });
    expect(res.status).toBe(404);
  });

  it('404s when no trigger token is configured', async () => {
    const res = await run(env({ SCHEDULER_MODE: 'external' }), { authorization: 'Bearer x' });
    expect(res.status).toBe(404);
  });

  it('401s without a bearer token', async () => {
    const res = await run(env({ SCHEDULER_MODE: 'external', CRON_TRIGGER_TOKEN: 'tok' }));
    expect(res.status).toBe(401);
  });

  it('401s with the wrong token', async () => {
    const res = await run(env({ SCHEDULER_MODE: 'external', CRON_TRIGGER_TOKEN: 'tok' }), {
      authorization: 'Bearer nope',
    });
    expect(res.status).toBe(401);
  });

  it('runs the periodic job with a correct token', async () => {
    const res = await run(env({ SCHEDULER_MODE: 'external', CRON_TRIGGER_TOKEN: 'tok' }), {
      authorization: 'Bearer tok',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, job: 'periodic' });
  });

  it('selects the daily job via ?job=daily', async () => {
    const res = await internalCronRoutes.request(
      '/cron/run?job=daily',
      { method: 'POST', headers: { authorization: 'Bearer tok' } },
      env({ SCHEDULER_MODE: 'external', CRON_TRIGGER_TOKEN: 'tok' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, job: 'daily' });
  });
});
