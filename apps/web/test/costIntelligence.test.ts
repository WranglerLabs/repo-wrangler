import { describe, expect, it } from 'vitest';
import type { EstateBudgetsDto, EstateUsageDto, UsageItemDto } from '@repo-wrangler/contracts';
import {
  buildWorkspaceCoverage,
  classifyCostNature,
  copilotSeatOpportunities,
  detectCostAnomalies,
  forecastCurrentMonth,
  knownTotal,
  repositoryBudgetCoverage,
} from '../src/lib/costIntelligence';

function usage(overrides: Partial<UsageItemDto> = {}): UsageItemDto {
  return {
    workspaceSlug: 'heritage-virginia', provider: 'github', usageDate: '2026-09-01',
    periodGranularity: 'day', product: 'Actions', sku: 'actions_linux', netAmount: 2,
    observedAt: '2026-09-02T00:00:00Z', ...overrides,
  };
}

describe('cost intelligence', () => {
  it('preserves unavailable amounts instead of converting them to zero', () => {
    expect(knownTotal([usage({ netAmount: undefined })], (item) => item.netAmount)).toEqual({
      value: undefined, known: 0, total: 1, complete: false,
    });
    expect(knownTotal([usage(), usage({ netAmount: undefined })], (item) => item.netAmount)).toEqual({
      value: 2, known: 1, total: 2, complete: false,
    });
  });

  it('separates fixed licenses, metered products, and unknown provider SKUs', () => {
    expect(classifyCostNature(usage({ product: 'Copilot', sku: 'Copilot Business seat',
      unitType: 'seats' }))).toBe('fixed_license');
    expect(classifyCostNature(usage({ product: 'Copilot', sku: 'Copilot AI Credits',
      unitType: 'credits' }))).toBe('metered');
    expect(classifyCostNature(usage({ product: 'Future Product', sku: 'future_sku',
      unitType: 'widgets' }))).toBe('unclassified');
  });

  it('forecasts only daily current-month provider data', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    expect(forecastCurrentMonth([
      usage({ usageDate: '2026-09-01', netAmount: 2 }),
      usage({ usageDate: '2026-09-05', netAmount: 3 }),
    ], now)).toMatchObject({ value: 30, throughDate: '2026-09-05', elapsedDays: 5, daysInMonth: 30 });
    expect(forecastCurrentMonth([
      usage({ periodGranularity: 'month' }),
    ], now)).toMatchObject({ value: undefined, complete: false });
  });

  it('reports observed products without a matching configured budget', () => {
    const usageData: EstateUsageDto = { items: [usage(), usage({ product: 'Packages', sku: 'packages_storage' })],
      capabilities: [{ workspaceSlug: 'heritage-virginia', provider: 'github', state: 'available', checkedAt: 'now' }] };
    const budgetData: EstateBudgetsDto = { state: 'available', items: [{
      workspaceSlug: 'heritage-virginia', provider: 'github', externalId: 'actions', product: 'Actions',
      productSkus: ['actions'], amount: 20, unit: 'USD', preventFurtherUsage: true,
      alertEnabled: true, alertRecipients: [], observedAt: 'now',
    }], capabilities: [{ workspaceSlug: 'heritage-virginia', provider: 'github', state: 'available', checkedAt: 'now' }] };
    expect(buildWorkspaceCoverage(usageData, budgetData)[0]).toMatchObject({
      usageProducts: ['Actions', 'Packages'], uncoveredProducts: ['Packages'],
      budgetCount: 1, budgetsWithoutAlerts: 0, softBudgets: 0,
      copilotSubscriptionState: 'not_checked', copilotSeatState: 'not_checked',
    });
  });

  it('distinguishes direct and inherited repository budget coverage', () => {
    const repository = {
      id: 'repo-1', provider: 'github', workspaceSlug: 'heritage-virginia', name: 'site',
      fullName: 'heritage-virginia/site', isArchived: false, defaultBranchStatus: 'unknown' as const,
      branchesAhead: 0, openChangeRequests: 0, attentionLevel: 'healthy' as const, status: 'active',
    };
    const base = {
      workspaceSlug: 'heritage-virginia', provider: 'github', productSkus: ['actions'],
      preventFurtherUsage: true, alertRecipients: [], observedAt: 'now',
    };
    const result = repositoryBudgetCoverage([repository], [
      { ...base, externalId: 'direct', scopeType: 'repository', scopeEntityName: 'site' },
      { ...base, externalId: 'inherited', scopeType: 'organization' },
      { ...base, externalId: 'user', scopeType: 'user', scopeEntityName: 'octocat' },
    ]);
    expect(result[0]).toMatchObject({ direct: 1, inherited: 1 });
    expect(result[0]?.budgets.map((item) => item.externalId)).toEqual(['direct', 'inherited']);
  });

  it('detects material recent cost increases without treating unknown amounts as zero', () => {
    const now = new Date('2026-09-14T12:00:00Z');
    const rows = [
      usage({ usageDate: '2026-09-02', netAmount: 1, repositoryFullName: 'org/repo' }),
      usage({ usageDate: '2026-09-09', netAmount: 4, repositoryFullName: 'org/repo' }),
    ];
    expect(detectCostAnomalies(rows, now)[0]).toMatchObject({
      repositoryFullName: 'org/repo', recentNet: 4, previousNet: 1, changePercent: 300,
    });
  });

  it('does not present an empty default Copilot response as assigned seats', () => {
    expect(copilotSeatOpportunities([{
      workspaceSlug: 'heritage-virginia', provider: 'github', planType: 'business',
      seatManagementSetting: 'unconfigured', totalSeats: 0,
      observedAt: 'now', lastSuccessfulSyncAt: 'now',
    }])[0]?.state).toBe('no_assigned_seats');
  });
});
