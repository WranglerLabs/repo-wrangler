import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeBudgetSnapshot, makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import {
  ensureGitHubConnection, replaceWorkspaceBudgets, setProviderCapability,
  upsertRepository, upsertUsage, upsertWorkspace,
} from '@repo-wrangler/persistence-d1';
import { apiRoutes } from '../src/api/routes';
import type { Env } from '../src/bindings';
import type { AppContext } from '../src/middleware/auth';

const migrationsDir = join(__dirname, '../../../migrations');

describe('budget and usage APIs', () => {
  let db: D1Database;
  let app: Hono<AppContext>;
  let workspaceId: string;
  let repositoryId: string;

  beforeEach(async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    db = opened.d1 as unknown as D1Database;
    app = new Hono<AppContext>();
    app.route('/api/v1', apiRoutes);
    const connectionId = await ensureGitHubConnection(db);
    workspaceId = await upsertWorkspace(db, connectionId,
      makeWorkspaceSnapshot({ slug: 'heritage-virginia' }));
    repositoryId = await upsertRepository(db, workspaceId,
      makeRepositorySnapshot({ fullName: 'heritage-virginia/site' }));
  });

  function env(): Env {
    return { DB: db, ASSETS: {}, DEMO_MODE: 'false' } as unknown as Env;
  }

  it('returns the full Heritage Virginia budget attribution instead of dashes', async () => {
    await replaceWorkspaceBudgets(db, workspaceId, [makeBudgetSnapshot({
      externalId: 'heritage-20', budgetType: 'SkuPricing', product: 'Actions',
      productSkus: ['actions_linux'], scopeType: 'repository',
      scopeEntityName: 'heritage-virginia/site', repositoryFullName: 'heritage-virginia/site',
      amount: 20, alertEnabled: true, alertRecipients: ['billing-manager'],
      preventFurtherUsage: true,
    })]);
    await setProviderCapability(db, workspaceId, 'budgets', 'available');

    const body = await (await app.request('/api/v1/budgets', {}, env())).json();
    expect(body.items[0]).toMatchObject({
      workspaceSlug: 'heritage-virginia', externalId: 'heritage-20',
      budgetType: 'SkuPricing', product: 'Actions', productSkus: ['actions_linux'],
      scopeType: 'repository', scopeEntityName: 'heritage-virginia/site',
      amount: 20, alertEnabled: true, alertRecipients: ['billing-manager'],
      preventFurtherUsage: true,
    });
  });

  it('returns actual repository usage and honest unavailable capability state', async () => {
    await upsertUsage(db, workspaceId, {
      usageDate: '2026-09-01', periodGranularity: 'day', product: 'Actions',
      sku: 'Actions Linux', repositoryFullName: 'heritage-virginia/site',
      quantity: 100, unitType: 'minutes', grossAmount: 0.8,
      discountAmount: 0.2, netAmount: 0.6, currency: 'USD',
      observedAt: '2026-09-02T00:00:00Z',
    });
    await setProviderCapability(db, workspaceId, 'usage', 'not_authorized', 'forbidden');
    const body = await (await app.request('/api/v1/usage', {}, env())).json();
    expect(body.items[0]).toMatchObject({ repositoryFullName: 'heritage-virginia/site',
      quantity: 100, grossAmount: 0.8, discountAmount: 0.2, netAmount: 0.6 });
    expect(body.capabilities[0]).toMatchObject({ state: 'not_authorized', errorCode: 'forbidden' });
  });

  it('shows retained repository budgets together with the latest failed capability check', async () => {
    await replaceWorkspaceBudgets(db, workspaceId, [makeBudgetSnapshot({
      externalId: 'heritage-20', product: 'Actions', productSkus: ['actions_linux'],
      scopeType: 'repository', scopeEntityName: 'heritage-virginia/site',
      repositoryFullName: 'heritage-virginia/site', amount: 20,
    })]);
    await setProviderCapability(db, workspaceId, 'budgets', 'available');
    await setProviderCapability(db, workspaceId, 'budgets', 'not_authorized',
      'forbidden', 'Organization Administration read is required.');

    const body = await (await app.request(`/api/v1/repositories/${repositoryId}`, {}, env())).json();
    expect(body.budgets).toMatchObject({
      state: 'available', capabilityState: 'not_authorized',
      capabilityErrorCode: 'forbidden',
      capabilityDetail: 'Organization Administration read is required.',
      capabilityLastSuccessAt: expect.any(String),
      items: [expect.objectContaining({ externalId: 'heritage-20', amount: 20 })],
    });
  });
});
