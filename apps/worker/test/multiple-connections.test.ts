import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import {
  createProviderConnection, getConnectionByType, listConnectionSummaries,
} from '@repo-wrangler/persistence-d1';
import { writableConnectionSecretProvider, resolveGitHubAppCredentials } from '../src/lib/connection-secrets';
import type { Env } from '../src/bindings';

const migrationsDir = join(__dirname, '../../../migrations');

describe('multiple provider connections', () => {
  it('resolves each GitHub App credential namespace independently', async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    const db = opened.d1 as unknown as D1Database;
    const env = { DB: db, ASSETS: {}, SECRET_ENCRYPTION_KEY: 'test-key',
      GITHUB_APP_ID: 'must-not-leak' } as unknown as Env;
    const first = await createProviderConnection(db, { providerType: 'github', displayName: 'One',
      authType: 'github_app', externalAccountId: '1' });
    const second = await createProviderConnection(db, { providerType: 'github', displayName: 'Two',
      authType: 'github_app', externalAccountId: '2' });
    for (const [id, appId] of [[first, 'app-one'], [second, 'app-two']] as const) {
      const secrets = await writableConnectionSecretProvider(env, db, id);
      await secrets.set('GITHUB_APP_ID', appId);
      await secrets.set('GITHUB_APP_PRIVATE_KEY', `${appId}-pem`);
    }
    expect(await resolveGitHubAppCredentials(env, db, first)).toMatchObject({ appId: 'app-one' });
    expect(await resolveGitHubAppCredentials(env, db, second)).toMatchObject({ appId: 'app-two' });
    expect(await getConnectionByType(db, 'github')).toBeNull();
    expect(await resolveGitHubAppCredentials(env, db)).toBeNull();
    expect(await listConnectionSummaries(db)).toHaveLength(2);
  });
});
