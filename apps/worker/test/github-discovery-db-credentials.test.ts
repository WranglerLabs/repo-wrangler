/**
 * Credential-entry test plan #3 (GitHub half — see
 * gitlab-discovery-from-workspaces.test.ts for the GitLab half): a GitHub App
 * connected entirely through the wizard — credentials in the `db` store
 * only, zero `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` env vars — is picked up
 * by discovery on the very next scheduled job. No restart, no env var.
 */
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import {
  D1ConnectionSecretStore,
  ensureGitHubConnection,
  setConnectionSecretReference,
} from '@repo-wrangler/persistence-d1';
import { DbSecretProvider, deriveEncryptionKey } from '@repo-wrangler/secrets-core';
import type { Env } from '../src/bindings';
import { runScheduled } from '../src/scheduled/index';

const migrationsDir = join(__dirname, '../../../migrations');

const mocks = vi.hoisted(() => ({
  listInstallations: vi.fn(),
  getInstallationToken: vi.fn(),
  listInstallationRepositories: vi.fn(),
}));

vi.mock('@repo-wrangler/provider-github', async () => {
  const actual = await vi.importActual<typeof import('@repo-wrangler/provider-github')>(
    '@repo-wrangler/provider-github',
  );
  return {
    ...actual,
    listInstallations: mocks.listInstallations,
    getInstallationToken: mocks.getInstallationToken,
    listInstallationRepositories: mocks.listInstallationRepositories,
  };
});

async function storeGitHubCredentials(db: D1Database, connectionId: string): Promise<void> {
  const key = await deriveEncryptionKey('test-key');
  const provider = new DbSecretProvider(new D1ConnectionSecretStore(db), connectionId, key);
  await provider.set('GITHUB_APP_ID', 'db-app-id');
  await provider.set('GITHUB_APP_PRIVATE_KEY', 'db-private-key');
  await setConnectionSecretReference(db, connectionId, connectionId);
}

function envNoGitHubVars(db: D1Database): Env {
  return { DB: db, ASSETS: {}, DEMO_MODE: 'false', SECRET_ENCRYPTION_KEY: 'test-key' } as unknown as Env;
}

describe('GitHub discovery — DB-only credentials (no restart)', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
    mocks.listInstallations.mockReset();
    mocks.getInstallationToken.mockReset();
    mocks.listInstallationRepositories.mockReset();
    mocks.listInstallations.mockResolvedValue([]);
  });

  it('runs discovery using only DB-stored GitHub App credentials', async () => {
    const connectionId = await ensureGitHubConnection(db);
    await storeGitHubCredentials(db, connectionId);

    await runScheduled(envNoGitHubVars(db), '*/5 * * * *');

    expect(mocks.listInstallations).toHaveBeenCalledWith('db-app-id', 'db-private-key');
  });

  it('no-ops discovery when neither env nor DB has GitHub credentials', async () => {
    await runScheduled(envNoGitHubVars(db), '*/5 * * * *');
    expect(mocks.listInstallations).not.toHaveBeenCalled();
  });
});
