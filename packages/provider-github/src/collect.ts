import type {
  BranchSnapshot,
  BudgetSnapshot,
  CapabilityResult,
  ChangeRequestSnapshot,
  GovernanceInfo,
  PipelineRunSnapshot,
  RepositorySnapshot,
  SecurityFindingSnapshot,
} from '@repo-wrangler/domain';
import {
  capabilityAvailable,
  capabilityStateFromHttpStatus,
  capabilityUnavailable,
  classifyComparison,
  isExcludedBranchName,
} from '@repo-wrangler/domain';
import { GitHubClient, hasNextPage } from './client';
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
}

/** One page of repositories accessible to an installation token. */
export async function listInstallationRepositories(
  token: string,
  page: number,
): Promise<RepoPage> {
  const client = new GitHubClient(token);
  const response = await client.request<{ repositories: any[] }>(
    `/installation/repositories?per_page=100&page=${page}`,
  );
  if (!response.ok || !response.data) {
    throw new Error(`Failed to list installation repositories (HTTP ${response.status}).`);
  }
  return {
    repositories: response.data.repositories.map(mapRepository),
    nextPage: hasNextPage(response.link) ? page + 1 : undefined,
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
    return capabilityUnavailable(capabilityStateFromHttpStatus(response.status));
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
          : capabilityStateFromHttpStatus(response.status);
    }
  }

  if (!anyAvailable) return capabilityUnavailable(lastState);
  return capabilityAvailable(findings);
}

/** Organization custom budgets (Phase 3). Requires org Administration read. */
export async function listOrganizationBudgets(
  token: string,
  orgSlug: string,
): Promise<CapabilityResult<BudgetSnapshot[]>> {
  const client = new GitHubClient(token);
  const response = await client.request<{ budgets?: any[] } | any[]>(
    `/orgs/${orgSlug}/settings/billing/budgets`,
  );
  if (!response.ok) {
    if (response.status === 404) return capabilityUnavailable('unsupported_by_plan');
    return capabilityUnavailable(capabilityStateFromHttpStatus(response.status));
  }
  const raw = Array.isArray(response.data) ? response.data : (response.data?.budgets ?? []);
  return capabilityAvailable(
    raw.map((budget: any, index: number) => ({
      externalId: String(budget.id ?? budget.budget_id ?? index),
      product: budget.product ?? budget.sku ?? undefined,
      scopeType: budget.target_type ?? budget.scope ?? undefined,
      scopeTarget: budget.target_name ?? undefined,
      amount: typeof budget.budget_amount === 'number' ? budget.budget_amount : budget.amount,
      unit: budget.unit ?? 'USD',
      preventFurtherUsage: Boolean(budget.prevent_further_usage ?? budget.stop_usage),
      alertStatus: budget.alert_status ?? undefined,
    })),
  );
}
