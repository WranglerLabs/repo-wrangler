/**
 * `connection_secrets` row store (migration 0004) against a real (in-memory)
 * SQLite-backed D1 handle — the same store `DbSecretProvider` (secrets-core)
 * writes through.
 */
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { D1ConnectionSecretStore, deleteAllConnectionSecrets, listConnectionSecretHints } from '../src/secrets';

const migrationsDir = join(__dirname, '../../../migrations');

describe('D1ConnectionSecretStore', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('round-trips set/get/delete', async () => {
    const store = new D1ConnectionSecretStore(db);
    expect(await store.get('conn-1', 'GITLAB_TOKEN')).toBeUndefined();

    await store.set('conn-1', 'GITLAB_TOKEN', {
      ciphertext: 'cipher',
      iv: 'iv-value',
      fingerprint: '1a2b',
    });
    expect(await store.get('conn-1', 'GITLAB_TOKEN')).toEqual({ ciphertext: 'cipher', iv: 'iv-value' });

    await store.delete('conn-1', 'GITLAB_TOKEN');
    expect(await store.get('conn-1', 'GITLAB_TOKEN')).toBeUndefined();
  });

  it('upserts on a repeated set (ON CONFLICT DO UPDATE)', async () => {
    const store = new D1ConnectionSecretStore(db);
    await store.set('conn-1', 'GITLAB_TOKEN', { ciphertext: 'c1', iv: 'i1', fingerprint: 'aa' });
    await store.set('conn-1', 'GITLAB_TOKEN', { ciphertext: 'c2', iv: 'i2', fingerprint: 'bb' });
    expect(await store.get('conn-1', 'GITLAB_TOKEN')).toEqual({ ciphertext: 'c2', iv: 'i2' });
  });

  it('listConnectionSecretHints reports names + fingerprints, not ciphertext', async () => {
    const store = new D1ConnectionSecretStore(db);
    await store.set('conn-1', 'GITHUB_APP_ID', { ciphertext: 'c', iv: 'i', fingerprint: '1234' });
    await store.set('conn-1', 'GITHUB_APP_PRIVATE_KEY', { ciphertext: 'c2', iv: 'i2', fingerprint: '5678' });
    await store.set('conn-2', 'GITLAB_TOKEN', { ciphertext: 'c3', iv: 'i3', fingerprint: '9abc' });

    const hints = await listConnectionSecretHints(db, 'conn-1');
    expect(hints.map((h) => h.name).sort()).toEqual(['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY']);
    expect(hints.every((h) => 'ciphertext' in h === false)).toBe(true);
  });

  it('deleteAllConnectionSecrets clears only the given namespace', async () => {
    const store = new D1ConnectionSecretStore(db);
    await store.set('conn-1', 'A', { ciphertext: 'c', iv: 'i', fingerprint: 'f' });
    await store.set('conn-2', 'B', { ciphertext: 'c', iv: 'i', fingerprint: 'f' });

    await deleteAllConnectionSecrets(db, 'conn-1');

    expect(await listConnectionSecretHints(db, 'conn-1')).toHaveLength(0);
    expect(await listConnectionSecretHints(db, 'conn-2')).toHaveLength(1);
  });
});
