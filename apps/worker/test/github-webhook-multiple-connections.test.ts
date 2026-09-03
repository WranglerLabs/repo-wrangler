import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import {
  createProviderConnection, getWorkspaceByConnectionAndExternalId, upsertRepository, upsertWorkspace,
} from '@repo-wrangler/persistence-d1';
import { makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import { writableConnectionSecretProvider } from '../src/lib/connection-secrets';
import { githubWebhookRoutes } from '../src/webhooks/github';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');

async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `sha256=${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

describe('GitHub webhooks with multiple Apps', () => {
  it('uses installation identity when two Apps share a webhook secret', async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    const db = opened.d1 as unknown as D1Database;
    const env = {
      DB: db, ASSETS: {}, SECRET_ENCRYPTION_KEY: 'test-key', DEMO_MODE: 'false',
    } as unknown as Env;
    const first = await createProviderConnection(db, {
      providerType: 'github', displayName: 'First', authType: 'github_app', externalAccountId: 'app-1',
    });
    const second = await createProviderConnection(db, {
      providerType: 'github', displayName: 'Second', authType: 'github_app', externalAccountId: 'app-2',
    });
    for (const [connectionId, appId] of [[first, 'app-1'], [second, 'app-2']] as const) {
      const secrets = await writableConnectionSecretProvider(env, db, connectionId);
      await secrets.set('GITHUB_APP_ID', appId);
      await secrets.set('GITHUB_APP_PRIVATE_KEY', `${appId}-key`);
      await secrets.set('GITHUB_WEBHOOK_SECRET', 'shared-webhook-secret');
    }
    await upsertWorkspace(db, first, makeWorkspaceSnapshot({
      externalId: '101', installationId: '1001', slug: 'first-org', kind: 'organization',
    }));
    await upsertWorkspace(db, second, makeWorkspaceSnapshot({
      externalId: '202', installationId: '2002', slug: 'second-org', kind: 'organization',
    }));
    const body = JSON.stringify({
      action: 'deleted', installation: { id: 2002, account: { id: 202, login: 'second-org' } },
    });
    const app = new Hono<AppContext>();
    app.route('/webhooks', githubWebhookRoutes);

    const response = await app.request('/webhooks/github', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'installation',
        'x-github-delivery': 'delivery-1',
        'x-hub-signature-256': await signature('shared-webhook-secret', body),
      },
      body,
    }, env);

    expect(response.status).toBe(200);
    expect((await getWorkspaceByConnectionAndExternalId(db, first, '101'))?.status).toBe('active');
    expect(await getWorkspaceByConnectionAndExternalId(db, second, '202')).toMatchObject({
      status: 'inaccessible', status_reason: 'app_uninstalled',
    });
  });

  it('records an organization.deleted event as provider resource deletion', async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    const db = opened.d1 as unknown as D1Database;
    const env = {
      DB: db, ASSETS: {}, SECRET_ENCRYPTION_KEY: 'test-key', DEMO_MODE: 'false',
    } as unknown as Env;
    const connectionId = await createProviderConnection(db, {
      providerType: 'github', displayName: 'App', authType: 'github_app', externalAccountId: 'app-1',
    });
    const secrets = await writableConnectionSecretProvider(env, db, connectionId);
    await secrets.set('GITHUB_APP_ID', 'app-1');
    await secrets.set('GITHUB_APP_PRIVATE_KEY', 'private-key');
    await secrets.set('GITHUB_WEBHOOK_SECRET', 'webhook-secret');
    const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot({
      externalId: '303', installationId: '3003', slug: 'deleted-org', kind: 'organization',
    }));
    const repositoryId = await upsertRepository(db, workspaceId, makeRepositorySnapshot({
      externalId: '404', fullName: 'deleted-org/repository',
    }));
    const body = JSON.stringify({
      action: 'deleted',
      organization: { id: 303, login: 'deleted-org' },
      installation: { id: 3003, account: { id: 303, login: 'deleted-org' } },
    });
    const app = new Hono<AppContext>();
    app.route('/webhooks', githubWebhookRoutes);
    const response = await app.request('/webhooks/github', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'organization',
        'x-github-delivery': 'delivery-org-deleted',
        'x-hub-signature-256': await signature('webhook-secret', body),
      },
      body,
    }, env);

    expect(response.status).toBe(200);
    expect(await getWorkspaceByConnectionAndExternalId(db, connectionId, '303')).toMatchObject({
      status: 'removed', status_reason: 'provider_resource_deleted',
    });
    expect(await db.prepare('SELECT status, status_reason FROM repositories WHERE id = ?1')
      .bind(repositoryId).first()).toMatchObject({
      status: 'removed', status_reason: 'provider_resource_deleted',
    });
  });
});
