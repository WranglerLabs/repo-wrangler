import type {
  BudgetDto,
  CopilotSubscriptionDto,
  EstateBudgetsDto,
  EstateUsageDto,
  UsageItemDto,
  RepositoryListItemDto,
} from '@repo-wrangler/contracts';

export type EstateBudget = BudgetDto & { workspaceSlug: string; provider: string };

export interface KnownTotal {
  value?: number;
  known: number;
  total: number;
  complete: boolean;
}

export interface CostForecast {
  value?: number;
  throughDate?: string;
  elapsedDays?: number;
  daysInMonth?: number;
  complete: boolean;
  reason?: string;
}

export interface WorkspaceCostCoverage {
  key: string;
  provider: string;
  workspaceSlug: string;
  usageState: string;
  budgetState: string;
  copilotSubscriptionState: string;
  copilotSeatState: string;
  usageProducts: string[];
  budgetProducts: string[];
  uncoveredProducts: string[];
  budgetCount: number;
  budgetsWithoutAlerts: number;
  softBudgets: number;
  latestUsageAt?: string;
  latestBudgetAt?: string;
}

export interface CostAnomaly {
  key: string;
  workspaceSlug: string;
  repositoryFullName?: string;
  product: string;
  recentNet: number;
  previousNet: number;
  changePercent?: number;
}

export interface CopilotSeatOpportunity {
  provider: string;
  workspaceSlug: string;
  planType: string;
  totalSeats: number;
  activeSeats?: number;
  inactiveSeats?: number;
  pendingCancellation?: number;
  state: 'no_assigned_seats' | 'review_inactive_seats' | 'assigned';
}

export function normalizeBillingLabel(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function knownTotal<T>(items: T[], select: (item: T) => number | undefined): KnownTotal {
  const values = items.map(select);
  const known = values.filter((value): value is number => value !== undefined);
  return {
    value: known.length === 0 ? undefined : known.reduce((sum, value) => sum + value, 0),
    known: known.length,
    total: values.length,
    complete: known.length === values.length,
  };
}

export function isCopilotUsage(item: Pick<UsageItemDto, 'product' | 'sku'>): boolean {
  const category = normalizeBillingLabel(`${item.product} ${item.sku}`);
  return category.includes('copilot') || category.includes('aicredit')
    || category.includes('premiumrequest');
}

export function isActionsUsage(item: Pick<UsageItemDto, 'product'>): boolean {
  return normalizeBillingLabel(item.product).includes('action');
}

export type CostNature = 'fixed_license' | 'metered' | 'unclassified';

export function classifyCostNature(
  item: Pick<UsageItemDto, 'product' | 'sku' | 'unitType'>,
): CostNature {
  const label = normalizeBillingLabel(`${item.product} ${item.sku}`);
  const unit = normalizeBillingLabel(item.unitType);
  if (label.includes('license') || label.includes('seat')
    || ['seat', 'seats', 'user', 'users', 'committer', 'committers', 'license', 'licenses'].includes(unit)) {
    return 'fixed_license';
  }
  if (label.includes('aicredit') || label.includes('premiumrequest')
    || label.includes('action') || label.includes('codespace') || label.includes('package')
    || label.includes('gitlfs') || label.includes('sandbox')
    || ['minute', 'minutes', 'hour', 'hours', 'credit', 'credits', 'request', 'requests',
      'gb', 'gigabyte', 'gigabytes', 'gigabytemonth', 'gigabytemonths'].includes(unit)) {
    return 'metered';
  }
  return 'unclassified';
}

export function currentMonthItems(items: UsageItemDto[], now: Date): UsageItemDto[] {
  const month = now.toISOString().slice(0, 7);
  return items.filter((item) => item.usageDate.slice(0, 7) === month);
}

export function forecastCurrentMonth(items: UsageItemDto[], now: Date): CostForecast {
  const current = currentMonthItems(items, now);
  if (current.length === 0) {
    return { value: undefined, complete: false, reason: 'No current-month usage has been imported.' };
  }
  if (current.some((item) => item.periodGranularity === 'month')) {
    return {
      value: undefined,
      complete: false,
      reason: 'A provider monthly aggregate is present; a daily run-rate forecast would double count it.',
    };
  }
  const net = knownTotal(current, (item) => item.netAmount);
  if (net.value === undefined) {
    return { value: undefined, complete: false, reason: 'The provider did not return monetary amounts.' };
  }
  const latest = current.map((item) => item.usageDate).sort().at(-1);
  if (!latest) return { value: undefined, complete: false, reason: 'No dated usage was returned.' };
  const parsed = new Date(`${latest}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { value: undefined, complete: false, reason: 'Usage dates are invalid.' };
  const elapsedDays = Math.max(1, parsed.getUTCDate());
  const daysInMonth = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    value: net.value / elapsedDays * daysInMonth,
    throughDate: latest,
    elapsedDays,
    daysInMonth,
    complete: net.complete,
  };
}

function productCovered(product: string, budgets: EstateBudget[]): boolean {
  const observed = normalizeBillingLabel(product);
  return budgets.some((budget) => {
    const configured = [budget.product, ...budget.productSkus]
      .map(normalizeBillingLabel).filter(Boolean);
    return configured.some((value) => value === observed || value.includes(observed) || observed.includes(value));
  });
}

export function buildWorkspaceCoverage(
  usage: EstateUsageDto | undefined,
  budgets: EstateBudgetsDto | undefined,
): WorkspaceCostCoverage[] {
  const keys = new Map<string, { provider: string; workspaceSlug: string }>();
  const remember = (provider: string, workspaceSlug: string) => {
    keys.set(`${provider}\u001f${workspaceSlug}`, { provider, workspaceSlug });
  };
  for (const item of usage?.items ?? []) remember(item.provider, item.workspaceSlug);
  for (const item of usage?.capabilities ?? []) remember(item.provider, item.workspaceSlug);
  for (const item of budgets?.items ?? []) remember(item.provider, item.workspaceSlug);
  for (const item of budgets?.capabilities ?? []) remember(item.provider, item.workspaceSlug);
  for (const item of budgets?.copilotSubscriptions ?? []) remember(item.provider, item.workspaceSlug);
  for (const item of budgets?.copilotCapabilities ?? []) remember(item.provider, item.workspaceSlug);
  for (const item of budgets?.copilotSeatCapabilities ?? []) remember(item.provider, item.workspaceSlug);

  return [...keys.entries()].map(([key, identity]) => {
    const workspaceUsage = (usage?.items ?? []).filter((item) => item.provider === identity.provider
      && item.workspaceSlug === identity.workspaceSlug);
    const workspaceBudgets = (budgets?.items ?? []).filter((item) => item.provider === identity.provider
      && item.workspaceSlug === identity.workspaceSlug);
    const usageCapability = usage?.capabilities.find((item) => item.provider === identity.provider
      && item.workspaceSlug === identity.workspaceSlug);
    const budgetCapability = budgets?.capabilities?.find((item) => item.provider === identity.provider
      && item.workspaceSlug === identity.workspaceSlug);
    const copilotSubscriptionCapability = budgets?.copilotCapabilities?.find((item) =>
      item.provider === identity.provider && item.workspaceSlug === identity.workspaceSlug);
    const copilotSeatCapability = budgets?.copilotSeatCapabilities?.find((item) =>
      item.provider === identity.provider && item.workspaceSlug === identity.workspaceSlug);
    const usageProducts = [...new Set(workspaceUsage.map((item) => item.product))].sort();
    const budgetProducts = [...new Set(workspaceBudgets.flatMap((budget) =>
      budget.product ? [budget.product] : budget.productSkus))].sort();
    return {
      key,
      ...identity,
      usageState: usageCapability?.state ?? 'not_checked',
      budgetState: budgetCapability?.state ?? 'not_checked',
      copilotSubscriptionState: copilotSubscriptionCapability?.state ?? 'not_checked',
      copilotSeatState: copilotSeatCapability?.state ?? 'not_checked',
      usageProducts,
      budgetProducts,
      uncoveredProducts: usageProducts.filter((product) => !productCovered(product, workspaceBudgets)),
      budgetCount: workspaceBudgets.length,
      budgetsWithoutAlerts: workspaceBudgets.filter((budget) => budget.alertEnabled !== true).length,
      softBudgets: workspaceBudgets.filter((budget) => !budget.preventFurtherUsage).length,
      latestUsageAt: workspaceUsage.map((item) => item.observedAt).sort().at(-1),
      latestBudgetAt: workspaceBudgets.map((item) => item.lastSuccessfulSyncAt ?? item.observedAt).sort().at(-1),
    };
  }).sort((left, right) => left.workspaceSlug.localeCompare(right.workspaceSlug));
}

export function repositoryBudgetCoverage(
  repositories: RepositoryListItemDto[],
  budgets: EstateBudget[],
) {
  return repositories.map((repository) => {
    const applicable = budgets.filter((budget) => {
      if (budget.provider !== repository.provider || budget.workspaceSlug !== repository.workspaceSlug) return false;
      const scope = normalizeBillingLabel(budget.scopeType);
      if (scope.includes('user')) return false;
      if (!scope.includes('repo')) return ['organization', 'org', 'enterprise', 'costcenter']
        .some((value) => scope.includes(value));
      if (budget.repositoryId && budget.repositoryId === repository.id) return true;
      const entity = normalizeBillingLabel(budget.scopeEntityName ?? budget.scopeTarget);
      return entity === normalizeBillingLabel(repository.fullName) || entity === normalizeBillingLabel(repository.name);
    });
    return {
      repositoryId: repository.id,
      repositoryFullName: repository.fullName,
      provider: repository.provider,
      workspaceSlug: repository.workspaceSlug,
      budgets: applicable,
      direct: applicable.filter((budget) => normalizeBillingLabel(budget.scopeType).includes('repo')).length,
      inherited: applicable.filter((budget) => !normalizeBillingLabel(budget.scopeType).includes('repo')).length,
    };
  });
}

function utcDateOffset(date: Date, days: number): string {
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
  return shifted.toISOString().slice(0, 10);
}

export function detectCostAnomalies(items: UsageItemDto[], now: Date): CostAnomaly[] {
  const recentStart = utcDateOffset(now, -6);
  const previousStart = utcDateOffset(now, -13);
  const previousEnd = utcDateOffset(now, -7);
  const groups = new Map<string, UsageItemDto[]>();
  for (const item of items) {
    if (item.periodGranularity !== 'day' || item.netAmount === undefined) continue;
    const key = [item.provider, item.workspaceSlug, item.repositoryFullName ?? '', item.product].join('\u001f');
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const anomalies: CostAnomaly[] = [];
  for (const [key, rows] of groups) {
    const recentNet = rows.filter((row) => row.usageDate >= recentStart)
      .reduce((sum, row) => sum + (row.netAmount ?? 0), 0);
    const previousNet = rows.filter((row) => row.usageDate >= previousStart && row.usageDate <= previousEnd)
      .reduce((sum, row) => sum + (row.netAmount ?? 0), 0);
    const increase = recentNet - previousNet;
    if (recentNet <= 0 || increase < 1 || (previousNet > 0 && recentNet < previousNet * 1.5)) continue;
    const sample = rows[0]!;
    anomalies.push({
      key,
      workspaceSlug: sample.workspaceSlug,
      repositoryFullName: sample.repositoryFullName,
      product: sample.product,
      recentNet,
      previousNet,
      changePercent: previousNet === 0 ? undefined : increase / previousNet * 100,
    });
  }
  return anomalies.sort((left, right) => (right.recentNet - right.previousNet)
    - (left.recentNet - left.previousNet));
}

export function copilotSeatOpportunities(
  subscriptions: CopilotSubscriptionDto[],
): CopilotSeatOpportunity[] {
  return subscriptions.map((subscription) => {
    const activeSeats = subscription.activeThisCycle;
    const inactiveSeats = subscription.inactiveThisCycle
      ?? (activeSeats === undefined ? undefined : Math.max(0, subscription.totalSeats - activeSeats));
    const state: CopilotSeatOpportunity['state'] = subscription.totalSeats === 0
      ? 'no_assigned_seats'
      : (inactiveSeats ?? 0) > 0 ? 'review_inactive_seats' : 'assigned';
    return {
      provider: subscription.provider,
      workspaceSlug: subscription.workspaceSlug,
      planType: subscription.planType,
      totalSeats: subscription.totalSeats,
      activeSeats,
      inactiveSeats,
      pendingCancellation: subscription.pendingCancellation,
      state,
    };
  }).sort((left, right) => (right.inactiveSeats ?? -1) - (left.inactiveSeats ?? -1));
}
