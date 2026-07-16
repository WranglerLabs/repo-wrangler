/**
 * B11 — the queue used to claim at most three jobs every 15 minutes. A normal
 * discovery pass can enqueue hundreds of repository enrichments, so GitLab
 * detail jobs waited nearly a day even though their provider calls succeeded.
 */
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { enqueueSyncJob } from '@repo-wrangler/persistence-d1';
import type { Env } from '../src/bindings';
import { runScheduled } from '../src/scheduled';

const migrationsDir = join(__dirname, '../../../migrations');

function envFor(db: D1Database): Env {
  // Demo mode avoids unrelated periodic discovery/billing jobs. The queued
  // work still runs because a configured GitLab token enables scheduling.
  return {
    DB: db,
    ASSETS: {},
    DEMO_MODE: 'true',
    GITLAB_TOKEN: 'test-token',
    GITLAB_GROUPS: 'test-group',
  } as unknown as Env;
}

describe('scheduled queue throughput (B11)', () => {
  let db: D1Database;

  beforeEach(() => {
    const { d1, raw } = openSqliteD1(':memory:');
    applyMigrations(raw, migrationsDir);
    db = d1 as unknown as D1Database;
  });

  it('drains ten cheap jobs in one tick instead of stopping at the old three-job ceiling', async () => {
    for (let i = 0; i < 12; i++) {
      await enqueueSyncJob(db, 'enrich_repository', `missing/repository-${i}`, 1);
    }

    await runScheduled(envFor(db), '*/5 * * * *');

    const counts = await db
      .prepare(`SELECT state, COUNT(*) AS count FROM sync_jobs WHERE job_type = 'enrich_repository' GROUP BY state`)
      .all<{ state: string; count: number }>();
    const byState = Object.fromEntries(counts.results.map((row) => [row.state, row.count]));
    expect(byState.done).toBe(10);
    expect(byState.pending).toBe(2);
  });
});
