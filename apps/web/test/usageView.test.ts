import { describe, expect, it } from 'vitest';
import type { BudgetDto, UsageItemDto } from '@repo-wrangler/contracts';
import { aggregate, budgetApplies, isActionsMinute } from '../src/routes/Usage';
import { isCopilotBudget } from '../src/routes/Budgets';

function usage(overrides: Partial<UsageItemDto> = {}): UsageItemDto {
  return {
    workspaceSlug: 'heritage-virginia',
    provider: 'github',
    repositoryId: 'repo-site',
    repositoryFullName: 'heritage-virginia/site',
    usageDate: '2026-09-01',
    periodGranularity: 'day',
    product: 'Actions',
    sku: 'Actions Linux',
    unitType: 'minutes',
    observedAt: '2026-09-03T00:00:00Z',
    ...overrides,
  };
}

function budget(overrides: Partial<BudgetDto & { workspaceSlug: string; provider: string }> = {}) {
  return {
    externalId: 'budget-20',
    workspaceSlug: 'heritage-virginia',
    provider: 'github',
    repositoryId: 'repo-site',
    product: 'Actions',
    productSkus: ['actions_linux'],
    scopeType: 'repository',
    scopeEntityName: 'heritage-virginia/site',
    amount: 20,
    preventFurtherUsage: true,
    alertRecipients: [],
    observedAt: '2026-09-03T00:00:00Z',
    ...overrides,
  } satisfies BudgetDto & { workspaceSlug: string; provider: string };
}

describe('Actual Usage view calculations', () => {
  it('never converts unavailable amounts to zero and marks partial totals', () => {
    expect(aggregate([usage(), usage()], (item) => item.netAmount)).toEqual({
      value: undefined, complete: false, known: 0, total: 2,
    });
    expect(aggregate([usage({ netAmount: 4 }), usage()], (item) => item.netAmount)).toEqual({
      value: 4, complete: false, known: 1, total: 2,
    });
  });

  it('matches direct repository and inherited organization budgets only to applicable usage', () => {
    expect(budgetApplies(budget(), usage())).toBe(true);
    expect(budgetApplies(budget(), usage({ repositoryId: 'repo-other',
      repositoryFullName: 'heritage-virginia/other' }))).toBe(false);
    expect(budgetApplies(budget({ scopeType: 'organization', scopeEntityName: 'heritage-virginia' }),
      usage({ repositoryFullName: 'heritage-virginia/other' }))).toBe(true);
    expect(budgetApplies(budget({ repositoryId: undefined, scopeEntityName: 'site' }),
      usage({ repositoryId: undefined }))).toBe(true);
  });

  it('does not apply a SKU-priced budget to a different SKU in the same product', () => {
    expect(budgetApplies(budget({ budgetType: 'SkuPricing' }), usage())).toBe(true);
    expect(budgetApplies(budget({ budgetType: 'SkuPricing' }),
      usage({ sku: 'Actions Windows' }))).toBe(false);
  });

  it('recognizes Actions minute SKUs without depending on exact capitalization', () => {
    expect(isActionsMinute(usage({ product: 'github actions', unitType: 'Minutes' }))).toBe(true);
    expect(isActionsMinute(usage({ product: 'Packages', unitType: 'gigabytes' }))).toBe(false);
  });

  it('distinguishes metered Copilot and AI-credit budgets from the subscription', () => {
    expect(isCopilotBudget(budget({ product: 'Copilot', productSkus: ['ai_credits'] }))).toBe(true);
    expect(isCopilotBudget(budget({ product: 'Actions', productSkus: ['actions'] }))).toBe(false);
  });
});
