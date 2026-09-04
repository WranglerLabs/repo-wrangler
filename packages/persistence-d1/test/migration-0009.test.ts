import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSqliteD1 } from '@repo-wrangler/persistence-sqlite';

const migrationsDir = join(__dirname, '../../../migrations');

describe('0009 upgrade orchestration migration', () => {
  it('upgrades a populated v1.0.23 database without changing existing data', () => {
    const { raw } = openSqliteD1(':memory:');
    for (const name of [
      '0001_initial.sql', '0002_governance.sql', '0003_saved_views.sql',
      '0004_connection_secrets.sql', '0005_connection_app_slug.sql',
      '0006_estate_billing_operations.sql', '0007_copilot_subscriptions.sql',
      '0008_cost_billing_intelligence.sql',
    ]) raw.exec(readFileSync(join(migrationsDir, name), 'utf8'));
    raw.exec(`INSERT INTO provider_connections
      (id, provider_type, display_name, auth_type)
      VALUES ('existing', 'github', 'Existing connection', 'github_app')`);

    raw.exec(readFileSync(join(migrationsDir, '0009_upgrade_orchestration.sql'), 'utf8'));

    expect(raw.prepare('SELECT display_name FROM provider_connections').get())
      .toEqual({ display_name: 'Existing connection' });
    raw.prepare(`INSERT INTO upgrade_jobs (
      id, idempotency_key, deployment_target, controller_type, source_version,
      target_version, target_digest, actor_id, correlation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('job', 'key', 'installation', 'test', '1.0.23', '1.0.24',
        'sha256:target', 'owner', 'correlation');
    expect(raw.prepare('SELECT state FROM upgrade_jobs WHERE id = ?').get('job'))
      .toEqual({ state: 'requested' });
  });
});
