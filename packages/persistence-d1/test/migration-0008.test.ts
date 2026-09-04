import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSqliteD1 } from '@repo-wrangler/persistence-sqlite';

const migrationsDir = join(__dirname, '../../../migrations');

describe('0008 cost and billing intelligence migration', () => {
  it('upgrades a populated v1.0.22 database and preserves existing billing data', () => {
    const { raw } = openSqliteD1(':memory:');
    for (const name of [
      '0001_initial.sql', '0002_governance.sql', '0003_saved_views.sql',
      '0004_connection_secrets.sql', '0005_connection_app_slug.sql',
      '0006_estate_billing_operations.sql', '0007_copilot_subscriptions.sql',
    ]) raw.exec(readFileSync(join(migrationsDir, name), 'utf8'));
    raw.exec(`
      INSERT INTO provider_connections (id, provider_type, display_name, auth_type)
        VALUES ('connection', 'github', 'GitHub', 'github_app');
      INSERT INTO workspaces (id, connection_id, external_id, slug, kind)
        VALUES ('workspace', 'connection', '42', 'heritage-virginia', 'organization');
      INSERT INTO copilot_subscriptions (workspace_id, plan_type, total_seats)
        VALUES ('workspace', 'business', 1);
    `);

    raw.exec(readFileSync(join(migrationsDir, '0008_cost_billing_intelligence.sql'), 'utf8'));

    expect(raw.prepare('SELECT total_seats FROM copilot_subscriptions').get())
      .toEqual({ total_seats: 1 });
    raw.prepare(`INSERT INTO copilot_seats
      (id, workspace_id, external_user_id, user_login) VALUES (?, ?, ?, ?)`)
      .run('seat', 'workspace', '100', 'octocat');
    expect(raw.prepare('SELECT external_user_id, user_login, status FROM copilot_seats').get())
      .toEqual({ external_user_id: '100', user_login: 'octocat', status: 'active' });
  });
});
