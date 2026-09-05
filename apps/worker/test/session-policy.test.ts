import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { app } from '../src/index';
import type { Env } from '../src/bindings';
import { createSessionCookie, readSession } from '../src/lib/session';
import { resolveSessionPolicy, saveSessionPolicy } from '../src/lib/session-policy';
import { markSetupCompleted } from '../src/lib/setup-state';

const migrationsDir = join(__dirname, '../../../migrations');

function env(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: {},
    DEMO_MODE: 'false',
    SESSION_SECRET: 'session-secret',
    AUTH_PROVIDERS: 'local',
    LOCAL_DEV_USERS: 'operator',
    ...overrides,
  } as unknown as Env;
}

describe('session policy', () => {
  let db: D1Database;

  beforeEach(async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    db = opened.d1 as unknown as D1Database;
    await markSetupCompleted(db);
  });

  it('issues a browser-session cookie without a persistent lifetime', async () => {
    const cookie = await createSessionCookie(
      'session-secret',
      { login: 'operator@example.test', role: 'owner', provider: 'entra' },
      true,
      'Lax',
      { mode: 'browser', timeoutMinutes: null },
    );

    expect(cookie).not.toContain('Max-Age=');
    expect(cookie).not.toContain('Expires=');
    expect(await readSession('session-secret', cookie)).toMatchObject({
      login: 'operator@example.test',
      provider: 'entra',
    });
  });

  it('uses the configured fixed duration for persistent cookies', async () => {
    const cookie = await createSessionCookie(
      'session-secret',
      { login: 'operator', role: 'owner', provider: 'local' },
      true,
      'Lax',
      { mode: 'fixed', timeoutMinutes: 90 },
    );
    expect(cookie).toContain('Max-Age=5400');
  });

  it('resolves stored, deployment, and default policies in precedence order', async () => {
    expect(await resolveSessionPolicy(db, undefined)).toEqual({
      mode: 'fixed', timeoutMinutes: 720, source: 'default',
    });
    expect(await resolveSessionPolicy(db, '0')).toEqual({
      mode: 'browser', timeoutMinutes: null, source: 'deployment',
    });
    expect(await resolveSessionPolicy(db, '1440')).toEqual({
      mode: 'fixed', timeoutMinutes: 1440, source: 'deployment',
    });

    await saveSessionPolicy(db, { mode: 'browser' });
    expect(await resolveSessionPolicy(db, '1440')).toEqual({
      mode: 'browser', timeoutMinutes: null, source: 'stored',
    });
  });

  it('lets an administrator read and update policy and audits the change', async () => {
    const cookie = await createSessionCookie(
      'session-secret',
      { login: 'operator', role: 'owner', provider: 'local' },
      true,
    );
    const headers = { cookie, 'content-type': 'application/json' };

    const updated = await app.request(
      '/api/v1/admin/session-policy',
      { method: 'PUT', headers, body: JSON.stringify({ mode: 'browser' }) },
      env(db),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      mode: 'browser', timeoutMinutes: null, source: 'stored',
    });

    const current = await app.request('/api/v1/admin/session-policy', { headers }, env(db));
    expect(await current.json()).toEqual({
      mode: 'browser', timeoutMinutes: null, source: 'stored',
    });
    const audit = await db.prepare(
      `SELECT actor, action, detail FROM audit_events WHERE action = 'session.policy.updated'`,
    ).first<{ actor: string; action: string; detail: string }>();
    expect(audit).toEqual({
      actor: 'operator', action: 'session.policy.updated', detail: 'mode=browser',
    });
  });

  it('rejects invalid fixed durations', async () => {
    const cookie = await createSessionCookie(
      'session-secret',
      { login: 'operator', role: 'owner', provider: 'local' },
      true,
    );
    const response = await app.request(
      '/api/v1/admin/session-policy',
      {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'fixed', timeoutMinutes: 1 }),
      },
      env(db),
    );
    expect(response.status).toBe(400);
  });
});
