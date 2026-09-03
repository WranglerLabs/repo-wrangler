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
  upsertRepository,
  upsertWorkspace,
  setConnectionSecretReference,
} from '@repo-wrangler/persistence-d1';
import { DbSecretProvider, deriveEncryptionKey } from '@repo-wrangler/secrets-core';
import { connectionRoutes } from '../src/api/connections';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';
import { runScheduled } from '../src/scheduled/index';
import { runGitLabDiscovery } from '../src/scheduled/index';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';

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
    inspectGitLabToken: vi.fn().mockResolvedValue({
      status: 'read_scope_verified', details: { standardScopes: 'read_api' },
    }),
    getGroupWorkspace: mocks.getGroupWorkspace,
    listGroupProjects: mocks.listGroupProjects,
  };
});

const admin: SessionUserDto = { login: 'operator', role: 'admin' };

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
    // Stable numeric group identity survives a provider-side path rename.
    expect(mocks.getGroupWorkspace).toHaveBeenCalledWith(expect.anything(), 'grp-1');
    expect(mocks.listGroupProjects).toHaveBeenCalled();
    expect((await db.prepare(
      `SELECT slug FROM workspaces WHERE connection_id = ?1 AND external_id = 'grp-1'`,
    ).bind(connectionId).first<{ slug: string }>())?.slug).toBe('acme-labs');
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

  it('continues reconciling completed groups while preserving the failed group', async () => {
    const connectionId = await ensureGitLabConnection(db, 'https://gitlab.com');
    await storeGitLabToken(db, connectionId, 'db-only-token');
    const firstWorkspace = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: '1', slug: 'first', kind: 'group' }));
    const secondWorkspace = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: '2', slug: 'second', kind: 'group' }));
    const staleId = await upsertRepository(db, firstWorkspace,
      makeRepositorySnapshot({ externalId: 'stale', fullName: 'first/stale' }));
    const secondStaleId = await upsertRepository(db, secondWorkspace,
      makeRepositorySnapshot({ externalId: 'second-stale', fullName: 'second/stale' }));
    mocks.getGroupWorkspace.mockImplementation(async (_client, id: string) => ({
      externalId: id, slug: id === '1' ? 'first' : 'second', kind: 'group' as const,
    }));
    mocks.listGroupProjects.mockImplementation(async (_client, id: string) => {
      if (id === '1') throw new Error('Failed to list projects for 1 (HTTP 503).');
      return { repositories: [], nextPage: undefined };
    });
    await db.prepare(
      `INSERT INTO sync_jobs (id, job_type, priority, scope, state, attempts)
       VALUES ('partial-run', 'gitlab_discovery', 3, ?1, 'running', 1)`,
    ).bind(connectionId).run();

    await runGitLabDiscovery(envWithoutGitLabVars(db), 'partial-run', connectionId);

    expect(mocks.listGroupProjects).toHaveBeenCalledTimes(2);
    const repositories = await db.prepare(
      'SELECT id, status FROM repositories WHERE id IN (?1, ?2) ORDER BY id',
    ).bind(staleId, secondStaleId).all<{ id: string; status: string }>();
    expect(repositories.results).toEqual([
      { id: staleId, status: 'active' },
      { id: secondStaleId, status: 'inaccessible' },
    ].sort((left, right) => left.id.localeCompare(right.id)));
    expect(await db.prepare(
      `SELECT status, error_code, retry_eligible FROM discovery_runs WHERE id = 'partial-run'`,
    ).first()).toEqual({
      status: 'failed', error_code: 'partial_discovery_failure', retry_eligible: 1,
    });
    expect(await db.prepare(
      `SELECT state, last_error FROM sync_jobs WHERE id = 'partial-run'`,
    ).first()).toEqual({
      state: 'failed', last_error: '1 of 2 GitLab groups failed discovery.',
    });
  });

  it('marks a provider-deleted group and its repositories removed without deleting history', async () => {
    const connectionId = await ensureGitLabConnection(db, 'https://gitlab.com');
    await storeGitLabToken(db, connectionId, 'db-only-token');
    const workspaceId = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: '404', slug: 'deleted-group', kind: 'group' }));
    const repositoryId = await upsertRepository(db, workspaceId,
      makeRepositorySnapshot({ externalId: 'project', fullName: 'deleted-group/repo' }));
    mocks.getGroupWorkspace.mockRejectedValue(new Error('Failed to fetch GitLab group 404 (HTTP 404).'));

    await runGitLabDiscovery(envWithoutGitLabVars(db), 'deleted-group-run', connectionId);

    expect(await db.prepare('SELECT status, status_reason FROM workspaces WHERE id = ?1')
      .bind(workspaceId).first()).toEqual({
      status: 'removed', status_reason: 'provider_resource_deleted',
    });
    expect(await db.prepare('SELECT status, status_reason FROM repositories WHERE id = ?1')
      .bind(repositoryId).first()).toEqual({
      status: 'removed', status_reason: 'provider_resource_deleted',
    });

    await runGitLabDiscovery(envWithoutGitLabVars(db), 'deleted-group-repeat-run', connectionId);
    const repeatedRun = await db.prepare('SELECT summary FROM discovery_runs WHERE id = ?1')
      .bind('deleted-group-repeat-run').first<{ summary: string }>();
    expect(JSON.parse(repeatedRun?.summary ?? '{}')).toMatchObject({
      workspacesRemoved: 0,
      groupsFailed: 1,
      partial: true,
    });
  });
});
