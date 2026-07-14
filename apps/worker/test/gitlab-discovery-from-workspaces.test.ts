/**
 * Onboarding design B4 — GitLab discovery prefers a connection's persisted
 * `workspaces` rows (created via `POST /connections/:id/workspaces`) over
 * `GITLAB_GROUPS`, and falls back to the env var when none exist. Also
 * exercises the Credential-entry test plan's #3: a token entered at runtime
 * (DB-only, no `GITLAB_TOKEN` env var) is used by the very next job.
 */
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import {
  D1ConnectionSecretStore,
  ensureGitLabConnection,
  setConnectionSecretReference,
} from '@repo-wrangler/persistence-d1';
import { DbSecretProvider, deriveEncryptionKey } from '@repo-wrangler/secrets-core';
import { connectionRoutes } from '../src/api/connections';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';
import { runScheduled } from '../src/scheduled/index';

const migrationsDir = join(__dirname, '../../../migrations');

const mocks = vi.hoisted(() => ({
  getGroupWorkspace: vi.fn(),
  listGroupProjects: vi.fn(),
}));

vi.mock('@repo-wrangler/provider-gitlab', async () => {
  const actual = await vi.importActual<typeof import('@repo-wrangler/provider-gitlab')>(
    '@repo-wrangler/provider-gitlab',
  );
  return {
    ...actual,
    GitLabClient: vi.fn().mockImplementation(() => ({})),
    getGroupWorkspace: mocks.getGroupWorkspace,
    listGroupProjects: mocks.listGroupProjects,
  };
});

const admin: SessionUserDto = { login: 'kris', role: 'admin' };

async function storeGitLabToken(db: D1Database, connectionId: string, token: string): Promise<void> {
  const key = await deriveEncryptionKey('test-key');
  const provider = new DbSecretProvider(new D1ConnectionSecretStore(db), connectionId, key);
  await provider.set('GITLAB_TOKEN', token);
  await setConnectionSecretReference(db, connectionId, connectionId);
}

function envWithoutGitLabVars(db: D1Database): Env {
  // DEMO_MODE=false is the documented way an operator enters real mode ahead
  // of connecting anything through the wizard (bindings.ts `isDemoMode`) — no
  // GITHUB_APP_ID (GitHub discovery no-ops), no GITLAB_TOKEN/GITLAB_GROUPS,
  // proving the token resolves entirely from the `db` store.
  return { DB: db, ASSETS: {}, DEMO_MODE: 'false', SECRET_ENCRYPTION_KEY: 'test-key' } as unknown as Env;
}

describe('GitLab discovery — B4 workspace-sourced groups + DB-only credentials', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
    mocks.getGroupWorkspace.mockReset();
    mocks.listGroupProjects.mockReset();
    mocks.listGroupProjects.mockResolvedValue({ repositories: [], nextPage: undefined });
  });

  it('iterates persisted workspace rows instead of GITLAB_GROUPS when any exist', async () => {
    const connectionId = await ensureGitLabConnection(db, 'https://gitlab.com');
    await storeGitLabToken(db, connectionId, 'db-only-token');

    // Create a persisted workspace the way POST /connections/:id/workspaces does.
    const app = new Hono<AppContext>();
    app.use('*', async (c, next) => {
      c.set('user', admin);
      await next();
    });
    app.route('/api/v1', connectionRoutes);
    mocks.getGroupWorkspace.mockResolvedValue({ externalId: 'grp-1', slug: 'acme-labs', kind: 'group' });
    await app.request(
      `/api/v1/connections/${connectionId}/workspaces`,
      { method: 'POST', body: JSON.stringify({ externalIds: ['acme-labs'] }) },
      { ...envWithoutGitLabVars(db), DEMO_MODE: 'false' } as unknown as Env,
    );
    mocks.getGroupWorkspace.mockClear();

    await runScheduled(envWithoutGitLabVars(db), '*/5 * * * *');

    // Discovery re-fetched the persisted group (not GITLAB_GROUPS, which is unset).
    expect(mocks.getGroupWorkspace).toHaveBeenCalledWith(expect.anything(), 'acme-labs');
    expect(mocks.listGroupProjects).toHaveBeenCalled();
  });

  it('falls back to GITLAB_GROUPS when the connection has no persisted workspaces', async () => {
    const connectionId = await ensureGitLabConnection(db, 'https://gitlab.com');
    await storeGitLabToken(db, connectionId, 'db-only-token');
    mocks.getGroupWorkspace.mockResolvedValue({ externalId: 'grp-2', slug: 'env-group', kind: 'group' });

    const env = { ...envWithoutGitLabVars(db), GITLAB_GROUPS: 'env-group' } as unknown as Env;
    await runScheduled(env, '*/5 * * * *');

    expect(mocks.getGroupWorkspace).toHaveBeenCalledWith(expect.anything(), 'env-group');
  });

  it('does nothing when neither a DB token nor GITLAB_TOKEN/GITLAB_GROUPS is configured', async () => {
    await runScheduled(envWithoutGitLabVars(db), '*/5 * * * *');
    expect(mocks.getGroupWorkspace).not.toHaveBeenCalled();
  });
});
