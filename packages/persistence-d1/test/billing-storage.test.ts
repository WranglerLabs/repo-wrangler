import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { makeBudgetSnapshot, makeRepositorySnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import {
  ensureGitHubConnection, getProviderCapability, listApplicableRepositoryBudgets,
  listUsage, listWorkspaceBudgets, replaceWorkspaceBudgets, setProviderCapability,
  replaceWorkspaceUsagePeriod, upsertRepository, upsertUsage, upsertWorkspace,
} from '../src';

const migrationsDir = join(__dirname, '../../../migrations');

async function estate() {
  const { d1, raw } = openSqliteD1(':memory:');
  applyMigrations(raw, migrationsDir);
  const db = d1 as unknown as D1Database;
  const connectionId = await ensureGitHubConnection(db);
  const workspaceId = await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot());
  const repositoryId = await upsertRepository(db, workspaceId,
    makeRepositorySnapshot({ name: 'repo', fullName: 'acme/repo' }));
  return { db, workspaceId, repositoryId };
}

describe('billing persistence', () => {
  it('replaces a successful budget snapshot and removes deleted provider budgets', async () => {
    const { db, workspaceId } = await estate();
    await replaceWorkspaceBudgets(db, workspaceId, [
      makeBudgetSnapshot({ externalId: 'deleted-later' }),
      makeBudgetSnapshot({ externalId: 'kept', amount: 20 }),
    ]);
    await replaceWorkspaceBudgets(db, workspaceId, [
      makeBudgetSnapshot({ externalId: 'kept', amount: 30 }),
    ]);
    const rows = await listWorkspaceBudgets(db, workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ external_id: 'kept', amount: 30 });
  });

  it('returns direct repository budgets and inherited organization budgets only', async () => {
    const { db, workspaceId, repositoryId } = await estate();
    await replaceWorkspaceBudgets(db, workspaceId, [
      makeBudgetSnapshot({ externalId: 'direct', scopeType: 'repository',
        // GitHub's documented budget response uses the short repository name
        // in budget_entity_name rather than owner/repository.
        repositoryFullName: 'repo', scopeEntityName: 'repo' }),
      makeBudgetSnapshot({ externalId: 'other', scopeType: 'repository',
        repositoryFullName: 'acme/other', scopeEntityName: 'acme/other' }),
      makeBudgetSnapshot({ externalId: 'inherited', scopeType: 'organization' }),
      makeBudgetSnapshot({ externalId: 'user-only', scopeType: 'user', scopeEntityName: 'octocat' }),
    ]);
    const rows = await listApplicableRepositoryBudgets(db, workspaceId, repositoryId);
    expect(rows.map((row) => row.external_id)).toEqual(['direct', 'inherited']);
    const attributions = await db.prepare(
      `SELECT b.external_id, a.attribution_type FROM budget_repository_attributions a
       JOIN budgets b ON b.id = a.budget_id ORDER BY b.external_id`,
    ).all<{ external_id: string; attribution_type: string }>();
    expect(attributions.results).toEqual([
      { external_id: 'direct', attribution_type: 'direct' },
      { external_id: 'inherited', attribution_type: 'inherited' },
    ]);
  });

  it('attributes existing budgets when their repository is discovered later', async () => {
    const { db, workspaceId } = await estate();
    await replaceWorkspaceBudgets(db, workspaceId, [
      makeBudgetSnapshot({ externalId: 'org', scopeType: 'organization' }),
      makeBudgetSnapshot({
        externalId: 'late-direct', scopeType: 'repository', scopeEntityName: 'late-repo',
        repositoryFullName: 'late-repo',
      }),
      makeBudgetSnapshot({ externalId: 'someone', scopeType: 'user', scopeEntityName: 'octocat' }),
    ]);
    const lateRepositoryId = await upsertRepository(db, workspaceId,
      makeRepositorySnapshot({ externalId: 'late-id', name: 'late-repo', fullName: 'acme/late-repo' }));

    const rows = await listApplicableRepositoryBudgets(db, workspaceId, lateRepositoryId);
    expect(rows.map((row) => row.external_id)).toEqual(['late-direct', 'org']);
  });

  it('stores capability independently and updates usage idempotently', async () => {
    const { db, workspaceId } = await estate();
    await setProviderCapability(db, workspaceId, 'budgets', 'not_authorized', 'forbidden');
    expect(await getProviderCapability(db, workspaceId, 'budgets')).toMatchObject({
      state: 'not_authorized', error_code: 'forbidden',
    });
    const usage = {
      usageDate: '2026-09-01', periodGranularity: 'day' as const,
      product: 'Actions', sku: 'actions_linux',
      repositoryFullName: 'acme/repo', unitType: 'minutes', quantity: 10,
      grossAmount: 0.08, discountAmount: 0, netAmount: 0.08, currency: 'USD',
      observedAt: '2026-09-02T00:00:00Z',
    };
    await upsertUsage(db, workspaceId, usage);
    await upsertUsage(db, workspaceId, { ...usage, quantity: 12, netAmount: 0.096 });
    const rows = await listUsage(db, { workspaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 12, net_amount: 0.096 });
  });

  it('attributes GitHub usage when the provider returns a bare repository name', async () => {
    const { db, workspaceId, repositoryId } = await estate();
    await upsertUsage(db, workspaceId, {
      usageDate: '2026-09-01', periodGranularity: 'day',
      product: 'Actions', sku: 'Actions Linux', repositoryFullName: 'repo',
      unitType: 'minutes', quantity: 100, grossAmount: 0.8,
      discountAmount: 0, netAmount: 0.8, currency: 'USD',
      observedAt: '2026-09-03T00:00:00Z',
    });

    const rows = await listUsage(db, { workspaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ repository_id: repositoryId, quantity: 100 });
  });

  it('replaces a successful usage period so corrections and removed line items converge', async () => {
    const { db, workspaceId } = await estate();
    const base = {
      usageDate: '2026-09-01', periodGranularity: 'day' as const,
      product: 'Actions', unitType: 'minutes', currency: 'USD',
      repositoryFullName: 'acme/repo', observedAt: '2026-09-02T00:00:00Z',
    };
    await replaceWorkspaceUsagePeriod(db, workspaceId, '2026-09-01', '2026-09-30', [
      { ...base, sku: 'Actions Linux', quantity: 100, netAmount: 0.8 },
      { ...base, sku: 'Actions Windows', quantity: 10, netAmount: 0.16 },
    ], 'first-import');
    await replaceWorkspaceUsagePeriod(db, workspaceId, '2026-09-01', '2026-09-30', [
      { ...base, sku: 'Actions Linux', quantity: 80, discountAmount: 0.16, netAmount: 0.64 },
    ], 'corrected-import');

    const rows = await listUsage(db, { workspaceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sku: 'Actions Linux', quantity: 80, discount_amount: 0.16, net_amount: 0.64,
    });
  });
});
