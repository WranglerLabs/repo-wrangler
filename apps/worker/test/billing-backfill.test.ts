import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import {
  ensureGitHubConnection, listUsageImports, listWorkspaceBudgets,
  replaceWorkspaceBudgets, upsertWorkspace,
} from '@repo-wrangler/persistence-d1';
import { makeBudgetSnapshot, makeWorkspaceSnapshot } from '@repo-wrangler/test-support';
import type { Env } from '../src/bindings';
import { runBillingSync } from '../src/scheduled/index';

const migrationsDir = join(__dirname, '../../../migrations');
const mocks = vi.hoisted(() => ({
  getInstallationToken: vi.fn(),
  getOrganizationCopilotSubscription: vi.fn(),
  listOrganizationCopilotSeats: vi.fn(),
  listOrganizationBudgets: vi.fn(),
  listOrganizationUsage: vi.fn(),
}));

vi.mock('@repo-wrangler/provider-github', async () => {
  const actual = await vi.importActual<typeof import('@repo-wrangler/provider-github')>(
    '@repo-wrangler/provider-github',
  );
  return { ...actual, ...mocks };
});

describe('checkpointed billing and historical usage import', () => {
  let db: D1Database;
  let connectionId: string;

  beforeEach(async () => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    db = opened.d1 as unknown as D1Database;
    connectionId = await ensureGitHubConnection(db);
    await upsertWorkspace(db, connectionId, makeWorkspaceSnapshot({
      externalId: 'org-1', installationId: 'installation-1', slug: 'heritage-virginia',
      kind: 'organization',
    }));
    await db.prepare(
      `INSERT INTO sync_jobs (id, job_type, priority, scope, state)
       VALUES ('billing-backfill', 'billing', 8, ?1, 'running')`,
    ).bind(connectionId).run();
    mocks.getInstallationToken.mockReset().mockResolvedValue('installation-token');
    mocks.getOrganizationCopilotSubscription.mockReset().mockResolvedValue({
      state: 'available', data: { item: { planType: 'business', totalSeats: 4 }, subrequestsUsed: 1 },
    });
    mocks.listOrganizationCopilotSeats.mockReset().mockResolvedValue({
      state: 'available', data: { items: [], subrequestsUsed: 1 },
    });
    mocks.listOrganizationBudgets.mockReset().mockResolvedValue({
      state: 'available', data: { items: [], subrequestsUsed: 1 },
    });
    mocks.listOrganizationUsage.mockReset().mockImplementation(
      async (_token: string, _slug: string, period: { year: number; month: number }) => ({
        state: 'available',
        data: {
          subrequestsUsed: 3,
          items: [{
            usageDate: `${period.year}-${String(period.month).padStart(2, '0')}-01`,
            periodGranularity: 'day', product: 'Actions', sku: 'Actions Linux',
            quantity: 10, unitType: 'minutes', observedAt: '2026-09-03T00:00:00Z',
          }],
        },
      }),
    );
  });

  it('imports current and historical months, then checkpoints before exceeding the request budget', async () => {
    const env = {
      DB: db, ASSETS: {}, DEMO_MODE: 'false',
      GITHUB_APP_ID: 'app-id', GITHUB_APP_PRIVATE_KEY: 'private-key',
    } as unknown as Env;

    const used = await runBillingSync(env, 'billing-backfill', null, 10, connectionId);

    expect(used).toBe(10);
    expect(mocks.listOrganizationUsage).toHaveBeenCalledTimes(2);
    const job = await db.prepare(
      `SELECT state, cursor FROM sync_jobs WHERE id = 'billing-backfill'`,
    ).first<{ state: string; cursor: string }>();
    expect(job?.state).toBe('pending');
    expect(JSON.parse(job!.cursor)).toMatchObject({
      workspaceIndex: 0, monthOffset: 2, budgetsCompleted: true,
      copilotSubscriptionCompleted: true,
      copilotSeatsCompleted: true,
    });
    const imports = await listUsageImports(db);
    expect(imports).toHaveLength(2);
    expect(imports.every((item) => item.status === 'completed')).toBe(true);
    expect(new Set(imports.map((item) => item.period_start)).size).toBe(2);
  });

  it('retains the last successful budget snapshot when a later collection fails', async () => {
    const workspace = await db.prepare(
      `SELECT id FROM workspaces WHERE connection_id = ?1`,
    ).bind(connectionId).first<{ id: string }>();
    await replaceWorkspaceBudgets(db, workspace!.id, [
      makeBudgetSnapshot({ externalId: 'last-good', amount: 20, product: 'Actions' }),
    ]);
    mocks.listOrganizationBudgets.mockResolvedValue({
      state: 'not_authorized', detail: 'Administration read permission is required.',
      data: { items: [], subrequestsUsed: 1 },
    });
    const env = {
      DB: db, ASSETS: {}, DEMO_MODE: 'false',
      GITHUB_APP_ID: 'app-id', GITHUB_APP_PRIVATE_KEY: 'private-key',
    } as unknown as Env;

    await runBillingSync(env, 'billing-backfill', null, 10, connectionId);

    expect(await listWorkspaceBudgets(db, workspace!.id)).toEqual([
      expect.objectContaining({ external_id: 'last-good', amount: 20 }),
    ]);
  });
});
