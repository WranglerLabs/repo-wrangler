import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { upsertRepository } from '../src';
import { makeRepositorySnapshot } from '@repo-wrangler/test-support';

const migrationsDir = join(__dirname, '../../../migrations');

describe('0006 estate billing operations migration', () => {
  it('collapses legacy cross-workspace active duplicates without deleting history or monitoring choice', async () => {
    const { raw, d1 } = openSqliteD1(':memory:');
    for (const name of ['0001_initial.sql', '0002_governance.sql', '0003_saved_views.sql',
      '0004_connection_secrets.sql', '0005_connection_app_slug.sql']) {
      raw.exec(readFileSync(join(migrationsDir, name), 'utf8'));
    }
    raw.exec(`
      INSERT INTO provider_connections (id, provider_type, display_name, auth_type)
        VALUES ('connection', 'gitlab', 'GitLab', 'token');
      INSERT INTO workspaces (id, connection_id, external_id, slug, kind)
        VALUES ('old-group', 'connection', '10', 'old', 'group'),
               ('new-group', 'connection', '20', 'new', 'group');
      INSERT INTO repositories (id, workspace_id, external_id, name, full_name, monitoring_state)
        VALUES ('canonical', 'old-group', '99', 'repo', 'old/repo', 'monitored'),
               ('duplicate', 'new-group', '99', 'repo', 'new/repo', 'ignored');
    `);

    raw.exec(readFileSync(join(migrationsDir, '0006_estate_billing_operations.sql'), 'utf8'));

    const rows = raw.prepare(
      "SELECT id, status, status_reason, monitoring_state FROM repositories WHERE external_id = '99' ORDER BY id",
    ).all() as Array<{ id: string; status: string; status_reason: string | null; monitoring_state: string }>;
    expect(rows).toEqual([
      { id: 'canonical', status: 'active', status_reason: null, monitoring_state: 'ignored' },
      { id: 'duplicate', status: 'removed', status_reason: 'duplicate_merged', monitoring_state: 'ignored' },
    ]);
    expect(raw.prepare('SELECT repository_id FROM repository_provider_identities').get())
      .toEqual({ repository_id: 'canonical' });

    expect(await upsertRepository(
      d1 as unknown as D1Database,
      'new-group',
      makeRepositorySnapshot({ externalId: '99', name: 'repo', fullName: 'new/repo' }),
    )).toBe('duplicate');
    expect(raw.prepare(
      `SELECT repository_id, from_workspace_id, to_workspace_id FROM repository_move_history`,
    ).get()).toEqual({
      repository_id: 'duplicate', from_workspace_id: 'old-group', to_workspace_id: 'new-group',
    });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM repositories WHERE external_id = '99' AND status = 'active'`,
    ).get()).toEqual({ count: 1 });
  });
});
