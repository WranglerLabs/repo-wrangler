/**
 * Onboarding design Phase A — estate scope. Exercises the persistence layer
 * against a real (in-memory) SQLite-backed D1 handle, so these are genuine
 * round-trip tests rather than mocked-query assertions.
 */
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import {
  ensureGitHubConnection,
  getOverviewCounts,
  listRepositoryItems,
  setRepositoryMonitoringState,
  setWorkspaceMonitoringState,
  upsertPipelineRun,
  upsertRepository,
  upsertWorkspace,
} from '../src';

const migrationsDir = join(__dirname, '../../../migrations');

function makeDb(): D1Database {
  const { d1, raw } = openSqliteD1(':memory:');
  applyMigrations(raw, migrationsDir);
  return d1 as unknown as D1Database;
}

describe('setWorkspaceMonitoringState / setRepositoryMonitoringState — round-trip', () => {
  let db: D1Database;
  let connectionId: string;

  beforeEach(async () => {
    db = makeDb();
    connectionId = await ensureGitHubConnection(db);
  });

  it('round-trips a workspace between monitored and ignored', async () => {
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    expect(await setWorkspaceMonitoringState(db, workspaceId, 'ignored')).toBe(true);
    expect(await setWorkspaceMonitoringState(db, workspaceId, 'monitored')).toBe(true);
  });

  it('returns false for a workspace id that does not exist', async () => {
    expect(await setWorkspaceMonitoringState(db, 'no-such-id', 'ignored')).toBe(false);
  });

  it('round-trips a repository between monitored and ignored', async () => {
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    const repoId = await upsertRepository(db, workspaceId, makeRepositorySnapshot());
    expect(await setRepositoryMonitoringState(db, repoId, 'ignored')).toBe(true);
    expect(await setRepositoryMonitoringState(db, repoId, 'monitored')).toBe(true);
  });

  it('returns false for a repository id that does not exist', async () => {
    expect(await setRepositoryMonitoringState(db, 'no-such-id', 'ignored')).toBe(false);
  });
});

describe('listRepositoryItems — A3 monitoring-state filter', () => {
  it('excludes an ignored repo and every repo under an ignored workspace; includeIgnored returns them with state attached', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);

    const monitoredWorkspaceId = await upsertWorkspace(
      db,
      connectionId,
      makeWorkspaceSnapshot({ externalId: 'ws-monitored', slug: 'acme' }),
    );
    const ignoredWorkspaceId = await upsertWorkspace(
      db,
      connectionId,
      makeWorkspaceSnapshot({ externalId: 'ws-ignored', slug: 'legacy' }),
    );
    await setWorkspaceMonitoringState(db, ignoredWorkspaceId, 'ignored');

    const monitoredRepoId = await upsertRepository(
      db,
      monitoredWorkspaceId,
      makeRepositorySnapshot({ externalId: 'repo-monitored', fullName: 'acme/widget' }),
    );
    const ignoredRepoId = await upsertRepository(
      db,
      monitoredWorkspaceId,
      makeRepositorySnapshot({ externalId: 'repo-ignored', fullName: 'acme/legacy-thing' }),
    );
    await setRepositoryMonitoringState(db, ignoredRepoId, 'ignored');
    const repoUnderIgnoredWorkspaceId = await upsertRepository(
      db,
      ignoredWorkspaceId,
      makeRepositorySnapshot({ externalId: 'repo-under-ignored-ws', fullName: 'legacy/api' }),
    );

    const defaultView = await listRepositoryItems(db);
    expect(defaultView.map((r) => r.id)).toEqual([monitoredRepoId]);

    const fullView = await listRepositoryItems(db, { includeIgnored: true });
    const byId = new Map(fullView.map((r) => [r.id, r]));
    expect(byId.size).toBe(3);
    expect(byId.get(monitoredRepoId)?.monitoring_state).toBe('monitored');
    expect(byId.get(ignoredRepoId)?.monitoring_state).toBe('ignored');
    expect(byId.get(repoUnderIgnoredWorkspaceId)?.monitoring_state).toBe('monitored');
  });

  it('regression: a default deployment (nothing ignored) is unaffected', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    const repoId = await upsertRepository(db, workspaceId, makeRepositorySnapshot());

    expect((await listRepositoryItems(db)).map((r) => r.id)).toEqual([repoId]);
    expect((await listRepositoryItems(db, { includeIgnored: true })).map((r) => r.id)).toEqual([
      repoId,
    ]);
  });
});

describe('getOverviewCounts — A3 monitoring-state filter', () => {
  it('drops ignored repositories and workspaces from workspaces/repositories/failing/new7d', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);

    // Monitored workspace, monitored repo — the only row every count below
    // should include.
    const monitoredWorkspaceId = await upsertWorkspace(
      db,
      connectionId,
      makeWorkspaceSnapshot({ externalId: 'ws-monitored', slug: 'acme' }),
    );
    const countedRepoId = await upsertRepository(
      db,
      monitoredWorkspaceId,
      makeRepositorySnapshot({ externalId: 'repo-counted', fullName: 'acme/widget' }),
    );
    await upsertPipelineRun(
      db,
      countedRepoId,
      { externalId: 'run-counted', status: 'completed', conclusion: 'failure', branch: 'main' },
    );

    // Monitored workspace, ignored repo — excluded at the repo level.
    const ignoredRepoId = await upsertRepository(
      db,
      monitoredWorkspaceId,
      makeRepositorySnapshot({ externalId: 'repo-ignored', fullName: 'acme/legacy-thing' }),
    );
    await setRepositoryMonitoringState(db, ignoredRepoId, 'ignored');
    await upsertPipelineRun(
      db,
      ignoredRepoId,
      { externalId: 'run-ignored-repo', status: 'completed', conclusion: 'failure', branch: 'main' },
    );

    // Ignored workspace, monitored repo — excluded at the workspace level.
    const ignoredWorkspaceId = await upsertWorkspace(
      db,
      connectionId,
      makeWorkspaceSnapshot({ externalId: 'ws-ignored', slug: 'legacy' }),
    );
    await setWorkspaceMonitoringState(db, ignoredWorkspaceId, 'ignored');
    const repoUnderIgnoredWorkspaceId = await upsertRepository(
      db,
      ignoredWorkspaceId,
      makeRepositorySnapshot({ externalId: 'repo-under-ignored-ws', fullName: 'legacy/api' }),
    );
    await upsertPipelineRun(
      db,
      repoUnderIgnoredWorkspaceId,
      { externalId: 'run-ignored-ws', status: 'completed', conclusion: 'failure', branch: 'main' },
    );

    const counts = await getOverviewCounts(db);
    expect(counts.workspaces).toBe(1);
    expect(counts.repositories).toBe(1);
    expect(counts.failing).toBe(1);
    expect(counts.new7d).toBe(1);
  });

  it('regression: a default deployment (nothing ignored) counts every row', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    await upsertRepository(db, workspaceId, makeRepositorySnapshot());

    const counts = await getOverviewCounts(db);
    expect(counts.workspaces).toBe(1);
    expect(counts.repositories).toBe(1);
    expect(counts.new7d).toBe(1);
  });
});
