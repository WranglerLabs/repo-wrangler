import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import {
  ensureGitHubConnection, markUnseenInaccessible, markUnseenWorkspacesInactive,
  beginDiscoveryRun, markDiscoveryWorkspaceScanComplete,
  claimEnrichmentBatch, listWorkspacesForBilling, setConnectionStatus,
  countMonitoredWorkspaces, getOverviewCounts, listRepositoryItems,
  listWorkspaceRowsWithProvider,
  prepareDiscoveryRunForReconciliation, reconcileDiscoveryRunMissingRepositories,
  recordDiscoveryWorkspaceSeen, upsertRepository, upsertWorkspace,
  markWorkspaceState,
} from '../src';

const migrationsDir = join(__dirname, '../../../migrations');

function makeDb(): D1Database {
  const { d1, raw } = openSqliteD1(':memory:');
  applyMigrations(raw, migrationsDir);
  return d1 as unknown as D1Database;
}

describe('stable reconciliation lifecycle', () => {
  it('marks every prior repository inaccessible after a successful empty discovery', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    const repositoryId = await upsertRepository(db, workspaceId, makeRepositorySnapshot());

    await markUnseenInaccessible(db, workspaceId, []);

    const row = await db.prepare('SELECT status, status_reason FROM repositories WHERE id = ?1')
      .bind(repositoryId).first<{ status: string; status_reason: string }>();
    expect(row).toEqual({ status: 'inaccessible', status_reason: 'not_seen_after_complete_discovery' });
  });

  it('moves a stable provider repository identity instead of creating a duplicate', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const fromId = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: 'group-1', slug: 'old-group' }));
    const toId = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: 'group-2', slug: 'new-group' }));
    const repositoryId = await upsertRepository(db, fromId,
      makeRepositorySnapshot({ externalId: 'project-10', fullName: 'old-group/repo' }));

    const movedId = await upsertRepository(db, toId,
      makeRepositorySnapshot({ externalId: 'project-10', fullName: 'new-group/repo' }));

    expect(movedId).toBe(repositoryId);
    const repos = await db.prepare(
      "SELECT id, workspace_id, full_name FROM repositories WHERE external_id = 'project-10' AND status = 'active'",
    ).all<{ id: string; workspace_id: string; full_name: string }>();
    expect(repos.results).toEqual([{ id: repositoryId, workspace_id: toId, full_name: 'new-group/repo' }]);
    const moves = await db.prepare('SELECT from_workspace_id, to_workspace_id FROM repository_move_history')
      .all<{ from_workspace_id: string; to_workspace_id: string }>();
    expect(moves.results).toEqual([{ from_workspace_id: fromId, to_workspace_id: toId }]);
  });

  it('renames a repository in place by stable provider identity', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    const repositoryId = await upsertRepository(db, workspaceId,
      makeRepositorySnapshot({ externalId: 'stable-id', name: 'before', fullName: 'acme/before' }));

    expect(await upsertRepository(db, workspaceId,
      makeRepositorySnapshot({ externalId: 'stable-id', name: 'after', fullName: 'acme/after' })))
      .toBe(repositoryId);
    expect(await db.prepare(
      `SELECT id, name, full_name FROM repositories WHERE external_id = 'stable-id'`,
    ).first()).toEqual({ id: repositoryId, name: 'after', full_name: 'acme/after' });
  });

  it('keeps a move into an unmonitored group as inaccessible pending confirmation', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: 'monitored', slug: 'monitored' }));
    const repositoryId = await upsertRepository(db, workspaceId,
      makeRepositorySnapshot({ externalId: 'moving', fullName: 'monitored/repo' }));
    await beginDiscoveryRun(db, 'move-out-run', connectionId);
    await recordDiscoveryWorkspaceSeen(db, 'move-out-run', connectionId, 'monitored', workspaceId);
    await markDiscoveryWorkspaceScanComplete(db, 'move-out-run', workspaceId);
    await prepareDiscoveryRunForReconciliation(db, 'move-out-run');

    expect(await reconcileDiscoveryRunMissingRepositories(db, 'move-out-run')).toBe(1);
    expect(await db.prepare('SELECT status, status_reason FROM repositories WHERE id = ?1')
      .bind(repositoryId).first()).toEqual({
      status: 'inaccessible', status_reason: 'not_seen_after_complete_discovery',
    });
  });

  it('updates a renamed workspace by stable ID and tombstones unseen workspaces only on demand', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: 'org-1', slug: 'before' }));
    expect(await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: 'org-1', slug: 'after' }))).toBe(workspaceId);
    await markUnseenWorkspacesInactive(db, connectionId, [], 'unknown_pending_confirmation');
    const row = await db.prepare('SELECT slug, status, status_reason FROM workspaces WHERE id = ?1')
      .bind(workspaceId).first<{ slug: string; status: string; status_reason: string }>();
    expect(row).toEqual({ slug: 'after', status: 'inaccessible', status_reason: 'unknown_pending_confirmation' });
  });

  it('refuses missing reconciliation until the run is complete and ignores unfinished scopes', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const completeWorkspace = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: 'complete', slug: 'complete' }));
    const interruptedWorkspace = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ externalId: 'interrupted', slug: 'interrupted' }));
    const completeRepo = await upsertRepository(db, completeWorkspace,
      makeRepositorySnapshot({ externalId: 'one', fullName: 'complete/one' }));
    const interruptedRepo = await upsertRepository(db, interruptedWorkspace,
      makeRepositorySnapshot({ externalId: 'two', fullName: 'interrupted/two' }));
    await beginDiscoveryRun(db, 'run', connectionId);
    await recordDiscoveryWorkspaceSeen(db, 'run', connectionId, 'complete', completeWorkspace);
    await recordDiscoveryWorkspaceSeen(db, 'run', connectionId, 'interrupted', interruptedWorkspace);
    await markDiscoveryWorkspaceScanComplete(db, 'run', completeWorkspace);

    expect(await reconcileDiscoveryRunMissingRepositories(db, 'run')).toBe(0);
    await prepareDiscoveryRunForReconciliation(db, 'run');
    expect(await reconcileDiscoveryRunMissingRepositories(db, 'run')).toBe(1);
    const states = await db.prepare('SELECT id, status FROM repositories ORDER BY id')
      .all<{ id: string; status: string }>();
    expect(states.results).toEqual([
      { id: completeRepo, status: 'inaccessible' },
      { id: interruptedRepo, status: 'active' },
    ].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('excludes disabled connections from queued enrichment and billing selection', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ installationId: 'installation-1' }));
    await upsertRepository(db, workspaceId, makeRepositorySnapshot());

    expect(await listWorkspacesForBilling(db)).toHaveLength(1);
    expect(await claimEnrichmentBatch(db, 10)).toHaveLength(1);

    await setConnectionStatus(db, connectionId, 'disabled');
    expect(await listWorkspacesForBilling(db)).toEqual([]);
    expect(await claimEnrichmentBatch(db, 10)).toEqual([]);
    expect(await listWorkspaceRowsWithProvider(db)).toEqual([]);
    expect(await listRepositoryItems(db)).toEqual([]);
    expect(await countMonitoredWorkspaces(db)).toBe(0);
    expect(await getOverviewCounts(db)).toMatchObject({ workspaces: 0, repositories: 0 });
  });

  it('records a lifecycle change when only the reason changes to or from null', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    await db.prepare("UPDATE workspaces SET state_changed_at = '2000-01-01 00:00:00' WHERE id = ?1")
      .bind(workspaceId).run();
    await markWorkspaceState(db, workspaceId, 'active', 'discovery_failed_pending_confirmation');
    const failed = await db.prepare(
      'SELECT status, status_reason, state_changed_at FROM workspaces WHERE id = ?1',
    ).bind(workspaceId).first<{ status: string; status_reason: string; state_changed_at: string }>();
    expect(failed).toEqual({
      status: 'active',
      status_reason: 'discovery_failed_pending_confirmation',
      state_changed_at: expect.any(String),
    });
    expect(failed?.state_changed_at).not.toBe('2000-01-01 00:00:00');
    await db.prepare("UPDATE workspaces SET state_changed_at = '2000-01-01 00:00:00' WHERE id = ?1")
      .bind(workspaceId).run();
    await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    const recovered = await db.prepare(
      'SELECT status, status_reason, state_changed_at FROM workspaces WHERE id = ?1',
    ).bind(workspaceId).first<{ status: string; status_reason: null; state_changed_at: string }>();
    expect(recovered).toEqual({
      status: 'active', status_reason: null, state_changed_at: expect.any(String),
    });
    expect(recovered?.state_changed_at).not.toBe('2000-01-01 00:00:00');
  });
});
