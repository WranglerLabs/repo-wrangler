import type {
  BranchSnapshot,
  ChangeRequestSnapshot,
  PipelineRunSnapshot,
  RepositorySnapshot,
} from '@repo-wrangler/domain';
import { classifyComparison, isExcludedBranchName } from '@repo-wrangler/domain';
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
