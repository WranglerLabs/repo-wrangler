/**
 * Onboarding design Phase C2 — "new since last review". Exercises the
 * persistence layer against a real (in-memory) SQLite-backed D1 handle.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import {
  ensureGitHubConnection,
  getMeta,
  listNewSinceReview,
  setMeta,
  upsertRepository,
  upsertWorkspace,
} from '../src';

const migrationsDir = join(__dirname, '../../../migrations');

function makeDb(): D1Database {
  const { d1, raw } = openSqliteD1(':memory:');
  applyMigrations(raw, migrationsDir);
  return d1 as unknown as D1Database;
}

describe('listNewSinceReview — Phase C2', () => {
  it('returns only repositories first seen after the marker', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    const oldRepoId = await upsertRepository(
      db,
      workspaceId,
      makeRepositorySnapshot({ externalId: 'repo-old', fullName: 'acme/old' }),
    );

    // Backdate the "old" repo's first_seen_at so it falls before the marker.
    await db
      .prepare(`UPDATE repositories SET first_seen_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1`)
      .bind(oldRepoId)
      .run();

    const marker = '2020-01-01T00:00:00.000Z';
    const newRepoId = await upsertRepository(
      db,
      workspaceId,
      makeRepositorySnapshot({ externalId: 'repo-new', fullName: 'acme/new' }),
    );

    const rows = await listNewSinceReview(db, marker);
    expect(rows.map((r) => r.id)).toEqual([newRepoId]);
  });

  it('returns an empty list once every repo predates the marker', async () => {
    const db = makeDb();
    const connectionId = await ensureGitHubConnection(db);
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
    await upsertRepository(db, workspaceId, makeRepositorySnapshot());

    const farFuture = '2999-01-01T00:00:00.000Z';
    expect(await listNewSinceReview(db, farFuture)).toEqual([]);
  });

  it('getMeta/setMeta round-trip the review marker', async () => {
    const db = makeDb();
    expect(await getMeta(db, 'estate.last_reviewed_at')).toBeNull();
    await setMeta(db, 'estate.last_reviewed_at', '2026-07-14T00:00:00.000Z');
    expect(await getMeta(db, 'estate.last_reviewed_at')).toBe('2026-07-14T00:00:00.000Z');
    await setMeta(db, 'estate.last_reviewed_at', '2026-07-15T00:00:00.000Z');
    expect(await getMeta(db, 'estate.last_reviewed_at')).toBe('2026-07-15T00:00:00.000Z');
  });
});
