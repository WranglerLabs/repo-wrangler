import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { createProviderConnection, upsertRepository, upsertWorkspace } from '@repo-wrangler/persistence-d1';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import { writableConnectionSecretProvider } from '../src/lib/connection-secrets';
import { gitlabWebhookRoutes } from '../src/webhooks/gitlab';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');

describe('GitLab webhooks with multiple connections', () => {
  it('uses stable project identity to select the owning connection', async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    const db = opened.d1 as unknown as D1Database;
    const env = {
      DB: db, ASSETS: {}, SECRET_ENCRYPTION_KEY: 'test-key', DEMO_MODE: 'false',
    } as unknown as Env;
    const first = await createProviderConnection(db, {
      providerType: 'gitlab', displayName: 'First GitLab', authType: 'token',
      baseUrl: 'https://gitlab-one.example.com',
    });
    const second = await createProviderConnection(db, {
      providerType: 'gitlab', displayName: 'Second GitLab', authType: 'token',
      baseUrl: 'https://gitlab-two.example.com',
    });
    for (const connectionId of [first, second]) {
      const secrets = await writableConnectionSecretProvider(env, db, connectionId);
      await secrets.set('GITLAB_WEBHOOK_SECRET', 'shared-secret');
    }
    const firstWorkspace = await upsertWorkspace(db, first, makeWorkspaceSnapshot({
      externalId: '10', slug: 'first/root', kind: 'group',
    }));
    const secondWorkspace = await upsertWorkspace(db, second, makeWorkspaceSnapshot({
      externalId: '20', slug: 'second/root', kind: 'group',
    }));
    await upsertRepository(db, firstWorkspace, makeRepositorySnapshot({
      externalId: '111', fullName: 'first/root/service',
    }));
    const ownedRepositoryId = await upsertRepository(db, secondWorkspace, makeRepositorySnapshot({
      externalId: '222', fullName: 'second/root/nested/service',
    }));
    const payload = JSON.stringify({
      ref: 'refs/heads/main', after: 'abc123',
      project: {
        id: 222,
        // A nested project's immediate namespace is not the monitored root
        // group. Stable project identity must still find the existing row.
        namespace_id: 21,
        path_with_namespace: 'second/root/nested/service',
      },
    });
    const app = new Hono<AppContext>();
    app.route('/webhooks', gitlabWebhookRoutes);

    const response = await app.request('/webhooks/gitlab', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Push Hook',
        'x-gitlab-token': 'shared-secret',
      },
      body: payload,
    }, env);

    expect(response.status).toBe(200);
    expect(await db.prepare(
      `SELECT repository_id, name, head_sha FROM branches WHERE repository_id = ?1`,
    ).bind(ownedRepositoryId).first()).toEqual({
      repository_id: ownedRepositoryId, name: 'main', head_sha: 'abc123',
    });
    expect(await db.prepare(
      `SELECT COUNT(*) AS count FROM branches WHERE repository_id != ?1`,
    ).bind(ownedRepositoryId).first<{ count: number }>()).toEqual({ count: 0 });
  });

  it('deduplicates identical payloads independently for separate GitLab instances', async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    const db = opened.d1 as unknown as D1Database;
    const env = {
      DB: db, ASSETS: {}, SECRET_ENCRYPTION_KEY: 'test-key', DEMO_MODE: 'false',
    } as unknown as Env;
    const connections = await Promise.all([
      createProviderConnection(db, {
        providerType: 'gitlab', displayName: 'First GitLab', authType: 'token',
        baseUrl: 'https://gitlab-one.example.com',
      }),
      createProviderConnection(db, {
        providerType: 'gitlab', displayName: 'Second GitLab', authType: 'token',
        baseUrl: 'https://gitlab-two.example.com',
      }),
    ]);
    const repositoryIds: string[] = [];
    for (const [index, connectionId] of connections.entries()) {
      const secrets = await writableConnectionSecretProvider(env, db, connectionId);
      await secrets.set('GITLAB_WEBHOOK_SECRET', `secret-${index}`);
      const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot({
        externalId: '10', slug: `instance-${index}`, kind: 'group',
      }));
      repositoryIds.push(await upsertRepository(db, workspaceId, makeRepositorySnapshot({
        externalId: '222', fullName: `instance-${index}/service`,
      })));
    }
    const payload = JSON.stringify({
      ref: 'refs/heads/main', after: 'same-sha',
      project: { id: 222, namespace_id: 10, path_with_namespace: 'same/service' },
    });
    const app = new Hono<AppContext>();
    app.route('/webhooks', gitlabWebhookRoutes);

    for (const index of [0, 1]) {
      const response = await app.request('/webhooks/gitlab', {
        method: 'POST',
        headers: {
          'content-type': 'application/json', 'x-gitlab-event': 'Push Hook',
          'x-gitlab-token': `secret-${index}`,
        },
        body: payload,
      }, env);
      expect(response.status).toBe(200);
    }

    const branches = await db.prepare(
      `SELECT repository_id, head_sha FROM branches ORDER BY repository_id`,
    ).all<{ repository_id: string; head_sha: string }>();
    expect(branches.results).toEqual(repositoryIds.sort().map((repositoryId) => ({
      repository_id: repositoryId, head_sha: 'same-sha',
    })));
  });
});
