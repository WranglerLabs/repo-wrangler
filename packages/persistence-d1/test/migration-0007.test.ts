import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSqliteD1 } from '@repo-wrangler/persistence-sqlite';

const migrationsDir = join(__dirname, '../../../migrations');

describe('0007 Copilot subscriptions migration', () => {
  it('upgrades a populated v1.0.21 database without changing existing budgets', () => {
    const { raw } = openSqliteD1(':memory:');
    for (const name of [
      '0001_initial.sql', '0002_governance.sql', '0003_saved_views.sql',
      '0004_connection_secrets.sql', '0005_connection_app_slug.sql',
      '0006_estate_billing_operations.sql',
    ]) raw.exec(readFileSync(join(migrationsDir, name), 'utf8'));
    raw.exec(`
      INSERT INTO provider_connections (id, provider_type, display_name, auth_type)
        VALUES ('connection', 'github', 'GitHub', 'github_app');
      INSERT INTO workspaces (id, connection_id, external_id, slug, kind)
        VALUES ('workspace', 'connection', '42', 'heritage-virginia', 'organization');
      INSERT INTO budgets (
        id, workspace_id, external_id, product_skus, prevent_further_usage, alert_recipients
      ) VALUES ('budget', 'workspace', 'heritage-20', '["actions"]', 1, '[]');
    `);

    raw.exec(readFileSync(join(migrationsDir, '0007_copilot_subscriptions.sql'), 'utf8'));

    expect(raw.prepare('SELECT external_id FROM budgets').get())
      .toEqual({ external_id: 'heritage-20' });
    raw.prepare(`INSERT INTO copilot_subscriptions (workspace_id, plan_type, total_seats)
      VALUES (?, ?, ?)`)
      .run('workspace', 'business', 12);
    expect(raw.prepare(
      'SELECT workspace_id, plan_type, total_seats FROM copilot_subscriptions',
    ).get()).toEqual({ workspace_id: 'workspace', plan_type: 'business', total_seats: 12 });
  });
});
