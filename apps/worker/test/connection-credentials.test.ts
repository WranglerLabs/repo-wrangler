/**
 * Onboarding design "Credential entry" — replace/rotate and disconnect
 * (B5 Credentials panel). `GET .../credentials` returns hints only; `PUT`
 * rotates without losing the connection id or its monitoring state; `DELETE`
 * tombstones the connection and wipes its secret namespace.
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import {
  D1ConnectionSecretStore,
  ensureGitHubConnection,
  getConnectionById,
  getConnectionByType,
  listAuditEvents,
  setConnectionSecretReference,
} from '@repo-wrangler/persistence-d1';
import { DbSecretProvider, deriveEncryptionKey } from '@repo-wrangler/secrets-core';
import { connectionRoutes } from '../src/api/connections';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');
const admin: SessionUserDto = { login: 'operator', role: 'admin' };
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

function realEnv(db: D1Database): Env {
  return { DB: db, ASSETS: {}, DEMO_MODE: 'false', SECRET_ENCRYPTION_KEY: 'test-key' } as unknown as Env;
}

async function connectedConnection(db: D1Database): Promise<string> {
  const connectionId = await ensureGitHubConnection(db);
  const key = await deriveEncryptionKey('test-key');
  const provider = new DbSecretProvider(new D1ConnectionSecretStore(db), connectionId, key);
  await provider.set('GITHUB_APP_ID', 'app-1');
  await provider.set('GITHUB_APP_PRIVATE_KEY', 'pem-1');
  await setConnectionSecretReference(db, connectionId, connectionId);
  return connectionId;
}

describe('GET /api/v1/connections/:id/credentials — hints only, never the value', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('returns presence and a masked hint, never the plaintext', async () => {
    const connectionId = await connectedConnection(db);
    const res = await testApp(admin).request(`/api/v1/connections/${connectionId}/credentials`, {}, realEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    for (const hint of body) {
      expect(hint.present).toBe(true);
      expect(hint.hint).toMatch(/^••••/);
    }
    expect(JSON.stringify(body)).not.toContain('pem-1');
    expect(JSON.stringify(body)).not.toContain('app-1');
  });
});

describe('PUT /api/v1/connections/:id/credentials — rotation', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('403s a viewer', async () => {
    const connectionId = await connectedConnection(db);
    const res = await testApp(viewer).request(
      `/api/v1/connections/${connectionId}/credentials`,
      { method: 'PUT', body: JSON.stringify({ name: 'GITHUB_APP_PRIVATE_KEY', value: 'new' }) },
      realEnv(db),
    );
    expect(res.status).toBe(403);
  });

  it('409s in demo mode', async () => {
    const connectionId = await connectedConnection(db);
    const res = await testApp(admin).request(
      `/api/v1/connections/${connectionId}/credentials`,
      { method: 'PUT', body: JSON.stringify({ name: 'GITHUB_APP_PRIVATE_KEY', value: 'new' }) },
      { DB: db, ASSETS: {} } as unknown as Env,
    );
    expect(res.status).toBe(409);
  });

  it('rotates the value, writes exactly one audit row with no value in it, keeps the connection id stable', async () => {
    const connectionId = await ensureGitHubConnection(db);
    const key = await deriveEncryptionKey('test-key');
    const provider = new DbSecretProvider(new D1ConnectionSecretStore(db), connectionId, key);
    await provider.set('GITHUB_APP_PRIVATE_KEY', 'old-pem');
    await setConnectionSecretReference(db, connectionId, connectionId);

    const res = await testApp(admin).request(
      `/api/v1/connections/${connectionId}/credentials`,
      { method: 'PUT', body: JSON.stringify({ name: 'GITHUB_APP_PRIVATE_KEY', value: 'new-pem' }) },
      realEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('GITHUB_APP_PRIVATE_KEY');
    expect(body.hint).toMatch(/^••••/);

    expect(await provider.get('GITHUB_APP_PRIVATE_KEY')).toBe('new-pem');
    // Connection id is stable — the row was never re-created.
    expect(await getConnectionById(db, connectionId)).not.toBeNull();

    const audit = await listAuditEvents(db);
    const rotations = audit.filter((e) => e.action === 'connection.credential.rotate');
    expect(rotations).toHaveLength(1);
    expect(rotations[0]!.detail).not.toContain('new-pem');
  });
});

describe('DELETE /api/v1/connections/:id — disconnect (B5)', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('tombstones the connection and wipes its secrets', async () => {
    const connectionId = await connectedConnection(db);
    const res = await testApp(admin).request(
      `/api/v1/connections/${connectionId}`,
      { method: 'DELETE' },
      realEnv(db),
    );
    expect(res.status).toBe(200);

    const connection = await getConnectionById(db, connectionId);
    expect(connection?.status).toBe('removed');

    const hints = await testApp(admin).request(
      `/api/v1/connections/${connectionId}/credentials`,
      {},
      realEnv(db),
    );
    expect(await hints.json()).toEqual([]);
  });

  it('reconnecting after a disconnect creates a fresh connection, not the tombstoned one', async () => {
    const firstId = await connectedConnection(db);
    await testApp(admin).request(`/api/v1/connections/${firstId}`, { method: 'DELETE' }, realEnv(db));

    const secondId = await ensureGitHubConnection(db);
    expect(secondId).not.toBe(firstId);
    // The old row is untouched (never-hard-delete) but no longer "the" connection.
    expect((await getConnectionById(db, firstId))?.status).toBe('removed');
    expect((await getConnectionByType(db, 'github'))?.id).toBe(secondId);
  });
});
