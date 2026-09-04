import type {
  BranchSnapshot,
  BudgetSnapshot,
  CapabilityResult,
  ChangeRequestSnapshot,
  CopilotSubscriptionSnapshot,
  CopilotSeatSnapshot,
  GovernanceInfo,
  PipelineRunSnapshot,
  RepositorySnapshot,
  SecurityFindingSnapshot,
  UsageSnapshot,
} from '@repo-wrangler/domain';
import {
  capabilityAvailable,
  capabilityStateFromHttpStatus,
  capabilityUnavailable,
  classifyComparison,
  isExcludedBranchName,
} from '@repo-wrangler/domain';
import {
  GITHUB_BILLING_API_VERSION,
  GitHubClient,
  hasNextPage,
  isSecondaryRateLimited,
} from './client';
import { mapPullRequest, mapRepository, mapWorkflowRun } from './mappers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Bounded collection functions used by the scheduled sync. Every function
 * takes explicit limits so an invocation stays inside the free-tier
 * subrequest and CPU budget; callers checkpoint between calls.
 */

export interface RepoPage {
  repositories: RepositorySnapshot[];
  nextPage?: number;
  /** Total repositories visible to the installation, from GitHub's `total_count`. */
  totalCount?: number;
}

/** One page of repositories accessible to an installation token. */
export async function listInstallationRepositories(
  token: string,
  page: number,
): Promise<RepoPage> {
  const client = new GitHubClient(token);
  const response = await client.request<{ total_count?: number; repositories: any[] }>(
    `/installation/repositories?per_page=100&page=${page}`,
  );
  if (!response.ok || !response.data) {
    throw new Error(`Failed to list installation repositories (HTTP ${response.status}).`);
  }
  return {
    repositories: response.data.repositories.map(mapRepository),
    nextPage: hasNextPage(response.link) ? page + 1 : undefined,
    totalCount: response.data.total_count,
  };
}

export async function listOpenPullRequests(
  token: string,
  fullName: string,
  limit = 50,
): Promise<ChangeRequestSnapshot[]> {
  const client = new GitHubClient(token);
  const response = await client.request<any[]>(
    `/repos/${fullName}/pulls?state=open&per_page=${Math.min(limit, 100)}`,
  );
  if (!response.ok || !response.data) {
    throw new Error(`Failed to list pull requests for ${fullName} (HTTP ${response.status}).`);
  }
  return response.data.map(mapPullRequest);
}

export async function latestDefaultBranchRun(
  token: string,
  fullName: string,
  defaultBranch: string,
): Promise<PipelineRunSnapshot | undefined> {
  const client = new GitHubClient(token);
  const response = await client.request<{ workflow_runs: any[] }>(
    `/repos/${fullName}/actions/runs?branch=${encodeURIComponent(defaultBranch)}&per_page=1`,
  );
  if (response.status === 404) return undefined; // Actions disabled.
  if (!response.ok || !response.data) {
    throw new Error(`Failed to fetch runs for ${fullName} (HTTP ${response.status}).`);
  }
  const run = response.data.workflow_runs[0];
  return run ? mapWorkflowRun(run) : undefined;
}

export interface BranchCollectionOptions {
  /** Hard cap on branches inventoried per repository. */
  maxBranches?: number;
  /** Hard cap on compare API calls per repository per invocation. */
  maxComparisons?: number;
  /** Branch names of open PR heads — prioritized for comparison. */
  openChangeRequestHeads?: Set<string>;
}

/**
 * Inventory branches and compare a bounded, prioritized subset against the
 * default branch. Branches over the comparison budget are left 'unknown'
 * and picked up by a later cycle (visible as partial coverage, never silent).
 */
export async function collectBranches(
  token: string,
  fullName: string,
  defaultBranch: string,
  options: BranchCollectionOptions = {},
): Promise<BranchSnapshot[]> {
  const maxBranches = options.maxBranches ?? 100;
  const maxComparisons = options.maxComparisons ?? 5;
  const prHeads = options.openChangeRequestHeads ?? new Set<string>();
  const client = new GitHubClient(token);

  const response = await client.request<any[]>(
    `/repos/${fullName}/branches?per_page=${Math.min(maxBranches, 100)}`,
  );
  if (!response.ok || !response.data) {
    throw new Error(`Failed to list branches for ${fullName} (HTTP ${response.status}).`);
  }

  const branches: BranchSnapshot[] = response.data.map((b: any) => {
    const excluded = isExcludedBranchName(String(b.name));
    return {
      name: String(b.name),
      headSha: b.commit?.sha ?? undefined,
      isDefault: b.name === defaultBranch,
      isProtected: Boolean(b.protected),
      comparisonStatus: b.name === defaultBranch ? ('identical' as const) : ('unknown' as const),
      excluded,
      excludedReason: excluded ? 'Matched instance branch exclusion pattern.' : undefined,
    };
  });

  // Comparison priority: open PR heads first, then the rest.
  const candidates = branches
    .filter((b) => !b.isDefault && !b.excluded)
    .sort((a, b) => Number(prHeads.has(b.name)) - Number(prHeads.has(a.name)));

  for (const branch of candidates.slice(0, maxComparisons)) {
    // eslint-disable-next-line no-await-in-loop -- serial keeps rate-limit pressure low
    const compare = await client.request<{
      ahead_by: number;
      behind_by: number;
      merge_base_commit?: any;
    }>(
      `/repos/${fullName}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch.name)}`,
    );
    if (compare.ok && compare.data) {
      branch.aheadBy = compare.data.ahead_by;
      branch.behindBy = compare.data.behind_by;
      branch.comparisonStatus = classifyComparison(compare.data.ahead_by, compare.data.behind_by);
      branch.comparedAt = new Date().toISOString();
    }
  }

  return branches;
}

/**
 * Governance signals from the community profile endpoint (one subrequest).
 * GitHub only exposes community profiles for public repositories — private
 * repos surface as a capability state, never a false "all files missing".
 */
export async function fetchGovernanceProfile(
  token: string,
  fullName: string,
  defaultBranchProtected: boolean | undefined,
): Promise<CapabilityResult<GovernanceInfo>> {
  const client = new GitHubClient(token);
  const response = await client.request<{
    health_percentage?: number;
    files?: Record<string, unknown>;
  }>(`/repos/${fullName}/community/profile`);
  if (!response.ok) {
    if (response.status === 404) {
      // Private repo: still report what we know from branch data.
      return capabilityAvailable({ defaultBranchProtected });
    }
    return capabilityUnavailable(
      capabilityStateFromHttpStatus(response.status, {
        rateLimited: isSecondaryRateLimited(response),
      }),
    );
  }
  const files = response.data?.files ?? {};
  return capabilityAvailable({
    defaultBranchProtected,
    healthPercentage: response.data?.health_percentage,
    files: {
      readme: files['readme'] !== null && files['readme'] !== undefined,
      license: files['license'] !== null && files['license'] !== undefined,
      contributing: files['contributing'] !== null && files['contributing'] !== undefined,
      codeOfConduct:
        files['code_of_conduct'] !== null && files['code_of_conduct'] !== undefined,
      issueTemplate:
        files['issue_template'] !== null && files['issue_template'] !== undefined,
      pullRequestTemplate:
        files['pull_request_template'] !== null && files['pull_request_template'] !== undefined,
    },
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Security alert reconciliation. Each category is independently
 * capability-gated: 403 → not_authorized, 404 → not_configured, etc.
 */
export async function listSecurityFindings(
  token: string,
  fullName: string,
): Promise<CapabilityResult<SecurityFindingSnapshot[]>> {
  const client = new GitHubClient(token);
  const findings: SecurityFindingSnapshot[] = [];
  let anyAvailable = false;
  let lastState: Exclude<CapabilityResult<SecurityFindingSnapshot[]>['state'], 'available'> =
    'not_configured';

  const sources: Array<{
    path: string;
    category: SecurityFindingSnapshot['category'];
    map: (alert: any) => SecurityFindingSnapshot;
  }> = [
    {
      path: `/repos/${fullName}/code-scanning/alerts?state=open&per_page=50`,
      category: 'code_scanning',
      map: (alert) => ({
        externalId: String(alert.number),
        category: 'code_scanning',
        severity: alert.rule?.security_severity_level ?? alert.rule?.severity,
        state: alert.state,
        ruleId: alert.rule?.id,
        ref: alert.most_recent_instance?.ref,
        url: alert.html_url,
        summary: alert.rule?.description,
        createdAt: alert.created_at,
        updatedAt: alert.updated_at,
      }),
    },
    {
      path: `/repos/${fullName}/dependabot/alerts?state=open&per_page=50`,
      category: 'dependency',
      map: (alert) => ({
        externalId: String(alert.number),
        category: 'dependency',
        severity: alert.security_advisory?.severity,
        state: alert.state,
        ruleId: alert.security_advisory?.ghsa_id,
        url: alert.html_url,
        summary: alert.security_advisory?.summary,
        createdAt: alert.created_at,
        updatedAt: alert.updated_at,
      }),
    },
    {
      path: `/repos/${fullName}/secret-scanning/alerts?state=open&per_page=50`,
      category: 'secret_scanning',
      map: (alert) => ({
        externalId: String(alert.number),
        category: 'secret_scanning',
        state: alert.state,
        ruleId: alert.secret_type,
        url: alert.html_url,
        // Display name only — never the secret value.
        summary: alert.secret_type_display_name,
        createdAt: alert.created_at,
        updatedAt: alert.updated_at,
      }),
    },
  ];

  for (const source of sources) {
    const response = await client.request<any[]>(source.path);
    if (response.ok && Array.isArray(response.data)) {
      anyAvailable = true;
      findings.push(...response.data.map(source.map));
    } else {
      lastState =
        response.status === 404
          ? 'not_configured'
          : capabilityStateFromHttpStatus(response.status, {
              rateLimited: isSecondaryRateLimited(response),
            });
    }
  }

  if (!anyAvailable) return capabilityUnavailable(lastState);
  return capabilityAvailable(findings);
}

export interface BillingCollection<T> {
  items: T[];
  subrequestsUsed: number;
}

interface GitHubBudget {
  id: string;
  budget_type: string;
  budget_product_skus: string[];
  budget_scope: string;
  budget_entity_name?: string;
  user?: string;
  budget_amount: number;
  prevent_further_usage: boolean;
  budget_alerting: { will_alert: boolean; alert_recipients: string[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

function parseBudget(value: unknown): GitHubBudget | null {
  if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')) return null;
  const budgetType = optionalString(value.budget_type);
  const budgetScope = optionalString(value.budget_scope);
  const budgetAmount = optionalNumber(value.budget_amount);
  const productSkus = stringArray(value.budget_product_skus)
    ?? (typeof value.budget_product_sku === 'string' ? [value.budget_product_sku] : undefined);
  if (!budgetType || !budgetScope || budgetAmount === undefined || !productSkus || productSkus.length === 0
    || typeof value.prevent_further_usage !== 'boolean') return null;
  const alerting = isRecord(value.budget_alerting) ? value.budget_alerting : undefined;
  const recipients = alerting ? stringArray(alerting.alert_recipients) : undefined;
  if (!alerting || typeof alerting.will_alert !== 'boolean' || !recipients) return null;
  return {
    id: String(value.id),
    budget_type: budgetType,
    budget_product_skus: productSkus,
    budget_scope: budgetScope,
    budget_entity_name: optionalString(value.budget_entity_name),
    user: optionalString(value.user),
    budget_amount: budgetAmount,
    prevent_further_usage: value.prevent_further_usage,
    budget_alerting: {
      will_alert: alerting.will_alert,
      alert_recipients: recipients,
    },
  };
}

function productFromSkus(skus: string[]): string | undefined {
  const first = skus[0]?.toLowerCase();
  if (!first) return undefined;
  if (first.includes('action')) return 'Actions';
  if (first.includes('package')) return 'Packages';
  if (first.includes('codespace')) return 'Codespaces';
  if (first.includes('copilot') || first.includes('premium_request') || first.includes('ai_credit')) return 'Copilot';
  return skus[0];
}

function budgetUnitFromSkus(skus: string[]): string | undefined {
  const normalized = skus.map((sku) => sku.toLowerCase());
  return normalized.some((sku) =>
    sku.includes('action') || sku.includes('package') || sku.includes('codespace')
      || sku.includes('ai_credit') || sku.includes('premium_request'))
    ? 'USD'
    : undefined;
}

/** Organization custom budgets. Requires organization Administration read. */
export async function listOrganizationBudgets(
  token: string,
  orgSlug: string,
  maxSubrequests = 100,
): Promise<CapabilityResult<BillingCollection<BudgetSnapshot>>> {
  const client = new GitHubClient(token);
  const collected: BudgetSnapshot[] = [];
  for (let page = 1; page <= maxSubrequests; page += 1) {
    const response = await client.request<unknown>(
      `/organizations/${encodeURIComponent(orgSlug)}/settings/billing/budgets?page=${page}&per_page=100`,
      { headers: { 'x-github-api-version': GITHUB_BILLING_API_VERSION } },
    );
    if (!response.ok) {
      const unavailable = response.status === 404
        ? capabilityUnavailable<BillingCollection<BudgetSnapshot>>('unsupported_by_plan')
        : capabilityUnavailable<BillingCollection<BudgetSnapshot>>(
            capabilityStateFromHttpStatus(response.status, {
              rateLimited: isSecondaryRateLimited(response),
            }),
          );
      return { ...unavailable, detail: unavailable.detail, data: { items: [], subrequestsUsed: page } };
    }
    if (!isRecord(response.data) || !Array.isArray(response.data.budgets)) {
      return { ...capabilityUnavailable('error', 'GitHub returned an invalid budgets response.'),
        data: { items: [], subrequestsUsed: page } };
    }
    const parsed = response.data.budgets.map(parseBudget);
    if (parsed.some((budget) => budget === null)) {
      return { ...capabilityUnavailable('error', 'GitHub returned an invalid budget record.'),
        data: { items: [], subrequestsUsed: page } };
    }
    for (const budget of parsed) {
      if (!budget) continue;
      const entity = budget.budget_entity_name;
      const scope = budget.budget_scope?.toLowerCase();
      const user = scope === 'user' ? budget.user ?? entity : undefined;
      collected.push({
        externalId: budget.id,
        budgetType: budget.budget_type,
        product: productFromSkus(budget.budget_product_skus),
        productSkus: budget.budget_product_skus,
        scopeType: budget.budget_scope,
        scopeTarget: entity,
        scopeEntityName: user ?? entity,
        repositoryFullName: scope === 'repository' || scope === 'repo' ? entity : undefined,
        organizationName: scope === 'organization' ? (entity || orgSlug) : orgSlug,
        userLogin: user,
        amount: budget.budget_amount,
        unit: budgetUnitFromSkus(budget.budget_product_skus),
        preventFurtherUsage: budget.prevent_further_usage,
        alertEnabled: budget.budget_alerting.will_alert,
        alertRecipients: budget.budget_alerting.alert_recipients,
        alertStatus: budget.budget_alerting.will_alert ? 'enabled' : 'disabled',
      });
    }
    if (response.data.has_next_page !== true) {
      return capabilityAvailable({ items: collected, subrequestsUsed: page });
    }
  }
  return { ...capabilityUnavailable('temporarily_unavailable', 'Budget pagination exceeded the request allowance.'),
    data: { items: [], subrequestsUsed: maxSubrequests } };
}

export interface CopilotSubscriptionCollection {
  item?: CopilotSubscriptionSnapshot;
  subrequestsUsed: number;
}

function parseCopilotSubscription(value: unknown): CopilotSubscriptionSnapshot | null {
  if (!isRecord(value)) return null;
  const seatBreakdown = value.seat_breakdown;
  if (!isRecord(seatBreakdown)) return null;
  const planType = optionalString(value.plan_type);
  const totalSeats = optionalNumber(seatBreakdown.total);
  if (!planType || totalSeats === undefined) return null;
  const optionalSeatFields = [
    'added_this_cycle', 'pending_invitation', 'pending_cancellation',
    'active_this_cycle', 'inactive_this_cycle',
  ] as const;
  if (optionalSeatFields.some((field) => seatBreakdown[field] !== undefined
    && optionalNumber(seatBreakdown[field]) === undefined)) return null;
  const optionalPolicyFields = [
    'seat_management_setting', 'ide_chat', 'platform_chat', 'cli', 'public_code_suggestions',
  ] as const;
  if (optionalPolicyFields.some((field) => value[field] !== undefined
    && optionalString(value[field]) === undefined)) return null;
  return {
    planType,
    seatManagementSetting: optionalString(value.seat_management_setting),
    totalSeats,
    addedThisCycle: optionalNumber(seatBreakdown.added_this_cycle),
    pendingInvitation: optionalNumber(seatBreakdown.pending_invitation),
    pendingCancellation: optionalNumber(seatBreakdown.pending_cancellation),
    activeThisCycle: optionalNumber(seatBreakdown.active_this_cycle),
    inactiveThisCycle: optionalNumber(seatBreakdown.inactive_this_cycle),
    ideChat: optionalString(value.ide_chat),
    platformChat: optionalString(value.platform_chat),
    cli: optionalString(value.cli),
    publicCodeSuggestions: optionalString(value.public_code_suggestions),
  };
}

/** Copilot Business/Enterprise subscription metadata; this is not a metered budget. */
export async function getOrganizationCopilotSubscription(
  token: string,
  orgSlug: string,
): Promise<CapabilityResult<CopilotSubscriptionCollection>> {
  const response = await new GitHubClient(token).request<unknown>(
    `/orgs/${encodeURIComponent(orgSlug)}/copilot/billing`,
    { headers: { 'x-github-api-version': GITHUB_BILLING_API_VERSION } },
  );
  if (!response.ok) {
    const state = response.status === 404 ? 'unsupported_by_plan'
      : capabilityStateFromHttpStatus(response.status, { rateLimited: isSecondaryRateLimited(response) });
    return { ...capabilityUnavailable(state), data: { subrequestsUsed: 1 } };
  }
  const item = parseCopilotSubscription(response.data);
  if (!item) return {
    ...capabilityUnavailable('error', 'GitHub returned an invalid Copilot subscription response.'),
    data: { subrequestsUsed: 1 },
  };
  return capabilityAvailable({ item, subrequestsUsed: 1 });
}

function parseCopilotSeat(value: unknown): CopilotSeatSnapshot | null {
  if (!isRecord(value) || !isRecord(value.assignee)) return null;
  const externalUserId = value.assignee.id;
  const userLogin = optionalString(value.assignee.login);
  if ((typeof externalUserId !== 'string' && typeof externalUserId !== 'number') || !userLogin) return null;
  const assigningTeam = isRecord(value.assigning_team) ? value.assigning_team : undefined;
  const stringFields = [
    'plan_type', 'created_at', 'updated_at', 'pending_cancellation_date',
    'last_activity_at', 'last_activity_editor', 'last_authenticated_at',
  ] as const;
  if (stringFields.some((field) => value[field] !== undefined && value[field] !== null
    && optionalString(value[field]) === undefined)) return null;
  if (assigningTeam?.slug !== undefined && optionalString(assigningTeam.slug) === undefined) return null;
  return {
    externalUserId: String(externalUserId),
    userLogin,
    planType: optionalString(value.plan_type),
    assigningTeamSlug: assigningTeam ? optionalString(assigningTeam.slug) : undefined,
    providerCreatedAt: optionalString(value.created_at),
    providerUpdatedAt: optionalString(value.updated_at),
    pendingCancellationAt: optionalString(value.pending_cancellation_date),
    lastActivityAt: optionalString(value.last_activity_at),
    lastActivityEditor: optionalString(value.last_activity_editor),
    lastAuthenticatedAt: optionalString(value.last_authenticated_at),
  };
}

/** Organization-billed Copilot seats, fully paginated and validated. */
export async function listOrganizationCopilotSeats(
  token: string,
  orgSlug: string,
  maxSubrequests = 100,
): Promise<CapabilityResult<BillingCollection<CopilotSeatSnapshot>>> {
  const client = new GitHubClient(token);
  const items: CopilotSeatSnapshot[] = [];
  for (let page = 1; page <= maxSubrequests; page += 1) {
    const response = await client.request<unknown>(
      `/orgs/${encodeURIComponent(orgSlug)}/copilot/billing/seats?page=${page}&per_page=100`,
      { headers: { 'x-github-api-version': GITHUB_BILLING_API_VERSION } },
    );
    if (!response.ok) {
      const state = response.status === 404 ? 'unsupported_by_plan'
        : capabilityStateFromHttpStatus(response.status, { rateLimited: isSecondaryRateLimited(response) });
      return { ...capabilityUnavailable(state), data: { items: [], subrequestsUsed: page } };
    }
    if (!isRecord(response.data) || !Array.isArray(response.data.seats)) {
      return { ...capabilityUnavailable('error', 'GitHub returned an invalid Copilot seats response.'),
        data: { items: [], subrequestsUsed: page } };
    }
    const parsed = response.data.seats.map(parseCopilotSeat);
    if (parsed.some((seat) => seat === null)) {
      return { ...capabilityUnavailable('error', 'GitHub returned an invalid Copilot seat record.'),
        data: { items: [], subrequestsUsed: page } };
    }
    items.push(...parsed.filter((seat): seat is CopilotSeatSnapshot => seat !== null));
    if (!hasNextPage(response.link) && response.data.has_next_page !== true) {
      return capabilityAvailable({ items, subrequestsUsed: page });
    }
  }
  return { ...capabilityUnavailable('temporarily_unavailable', 'Copilot seat pagination exceeded the request allowance.'),
    data: { items: [], subrequestsUsed: maxSubrequests } };
}

function parseUsageItem(
  value: unknown,
  fallbackDate: string,
  observedAt: string,
): UsageSnapshot | null {
  if (!isRecord(value)) return null;
  const product = optionalString(value.product);
  const sku = optionalString(value.sku);
  const unitType = optionalString(value.unitType);
  const numericFields = [
    'quantity', 'pricePerUnit', 'grossQuantity', 'discountQuantity', 'netQuantity',
    'grossAmount', 'discountAmount', 'netAmount',
  ] as const;
  if (!product || !sku || !unitType
    || numericFields.some((field) => value[field] !== undefined && optionalNumber(value[field]) === undefined)
    || (value.quantity === undefined && value.grossQuantity === undefined && value.netQuantity === undefined)) {
    return null;
  }
  const stringFields = [
    'date', 'repositoryName', 'organizationName', 'userName', 'model', 'currency',
  ] as const;
  if (stringFields.some((field) => value[field] !== undefined && optionalString(value[field]) === undefined)) {
    return null;
  }
  return {
    usageDate: optionalString(value.date) ?? fallbackDate,
    periodGranularity: typeof value.date === 'string' ? 'day' : 'month',
    product,
    sku,
    repositoryFullName: optionalString(value.repositoryName),
    organizationName: optionalString(value.organizationName),
    userLogin: optionalString(value.userName),
    model: optionalString(value.model),
    quantity: optionalNumber(value.quantity),
    unitType,
    pricePerUnit: optionalNumber(value.pricePerUnit),
    grossQuantity: optionalNumber(value.grossQuantity),
    discountQuantity: optionalNumber(value.discountQuantity),
    netQuantity: optionalNumber(value.netQuantity),
    grossAmount: optionalNumber(value.grossAmount),
    discountAmount: optionalNumber(value.discountAmount),
    netAmount: optionalNumber(value.netAmount),
    currency: optionalString(value.currency) ?? 'USD',
    observedAt,
  };
}

/** Current-period organization usage, including dedicated Copilot billing reports. */
export async function listOrganizationUsage(
  token: string,
  orgSlug: string,
  period: { year: number; month: number },
  maxSubrequests = 100,
): Promise<CapabilityResult<BillingCollection<UsageSnapshot>>> {
  const client = new GitHubClient(token);
  const query = `year=${period.year}&month=${period.month}`;
  const base = `/organizations/${encodeURIComponent(orgSlug)}/settings/billing`;
  const paths = [`${base}/usage?${query}`, `${base}/ai_credit/usage?${query}`,
    `${base}/premium_request/usage?${query}`];
  const items: UsageSnapshot[] = [];
  const observedAt = new Date().toISOString();
  const fallbackDate = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
  let unavailableState: Exclude<CapabilityResult<never>['state'], 'available'> | undefined;
  let subrequestsUsed = 0;
  for (const path of paths) {
    const reportItems: UsageSnapshot[] = [];
    for (let page = 1; ; page += 1) {
      if (subrequestsUsed >= maxSubrequests) {
        return {
          ...capabilityUnavailable('temporarily_unavailable', 'Usage pagination exceeded the request allowance.'),
          data: { items: [], subrequestsUsed },
        };
      }
      const requestPath = page === 1 ? path : `${path}&page=${page}&per_page=100`;
      const response = await client.request<unknown>(requestPath,
        { headers: { 'x-github-api-version': GITHUB_BILLING_API_VERSION } });
      subrequestsUsed += 1;
      if (!response.ok) {
        const state = response.status === 404 ? 'unsupported_by_plan'
          : capabilityStateFromHttpStatus(response.status, { rateLimited: isSecondaryRateLimited(response) });
        if (path.includes('/usage?')) return { ...capabilityUnavailable(state),
          data: { items: [], subrequestsUsed } };
        unavailableState = state;
        break;
      }
      if (!isRecord(response.data) || !Array.isArray(response.data.usageItems)) {
        return { ...capabilityUnavailable('error', 'GitHub returned an invalid usage response.'),
          data: { items: [], subrequestsUsed } };
      }
      const parsed = response.data.usageItems.map((item) => parseUsageItem(item, fallbackDate, observedAt));
      if (parsed.some((item) => item === null)) {
        return { ...capabilityUnavailable('error', 'GitHub returned an invalid usage record.'),
          data: { items: [], subrequestsUsed } };
      }
      reportItems.push(...parsed.filter((item): item is UsageSnapshot => item !== null));
      if (response.data.has_next_page !== true && !hasNextPage(response.link)) break;
    }
    const category = path.includes('/ai_credit/') ? 'ai credit'
      : path.includes('/premium_request/') ? 'premium request' : undefined;
    const alreadyInGeneral = category !== undefined && items.some((item) =>
      `${item.product} ${item.sku}`.toLowerCase().includes(category));
    if (!alreadyInGeneral) items.push(...reportItems);
  }
  const result = capabilityAvailable({ items, subrequestsUsed });
  return unavailableState ? { ...result, detail: `A supplemental usage report was ${unavailableState}.` } : result;
}
