import type {
  BranchSnapshot,
  ChangeRequestSnapshot,
  PipelineRunSnapshot,
  RepositorySnapshot,
  WorkspaceSnapshot,
} from '@repo-wrangler/domain';
import { classifyComparison, isExcludedBranchName } from '@repo-wrangler/domain';
import { GitLabClient } from './client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Bounded GitLab collectors. Group discovery uses the Groups API (available
 * on the Free tier) with include_subgroups so nested projects are found.
 */

export async function getGroupWorkspace(
  client: GitLabClient,
  groupPath: string,
): Promise<WorkspaceSnapshot> {
  const response = await client.request<any>(`/groups/${encodeURIComponent(groupPath)}?with_projects=false`);
  if (!response.ok || !response.data) {
    throw new Error(`Failed to fetch GitLab group ${groupPath} (HTTP ${response.status}).`);
  }
  const group = response.data;
  return {
    externalId: String(group.id),
    slug: String(group.full_path ?? group.path),
    displayName: group.name ?? undefined,
    kind: 'group',
    avatarUrl: group.avatar_url ?? undefined,
  };
}

export interface GitLabProjectPage {
  repositories: RepositorySnapshot[];
  nextPage?: number;
}

export async function listGroupProjects(
  client: GitLabClient,
  groupPath: string,
  page: number,
): Promise<GitLabProjectPage> {
  const response = await client.request<any[]>(
    `/groups/${encodeURIComponent(groupPath)}/projects?include_subgroups=true&archived=false&per_page=100&page=${page}&order_by=id&sort=asc`,
  );
  if (!response.ok || !response.data) {
    throw new Error(`Failed to list projects for ${groupPath} (HTTP ${response.status}).`);
  }
  return {
    repositories: response.data.map(mapProject),
    nextPage: response.nextPage,
  };
}

export function mapProject(project: any): RepositorySnapshot {
  return {
    externalId: String(project.id),
    name: String(project.path ?? project.name),
    fullName: String(project.path_with_namespace),
    url: project.web_url ?? undefined,
    description: project.description ?? undefined,
    visibility: project.visibility ?? undefined,
    isArchived: Boolean(project.archived),
    isFork: Boolean(project.forked_from_project),
    isDisabled: false,
    isTemplate: false,
    defaultBranch: project.default_branch ?? undefined,
    pushedAt: project.last_activity_at ?? undefined,
    providerUpdatedAt: project.last_activity_at ?? undefined,
    primaryLanguage: undefined,
    topics: Array.isArray(project.topics) ? project.topics.map(String) : [],
    licenseSpdx: project.license?.key ?? undefined,
  };
}

export async function listOpenMergeRequests(
  client: GitLabClient,
  projectId: string,
  limit = 50,
): Promise<ChangeRequestSnapshot[]> {
  const response = await client.request<any[]>(
    `/projects/${projectId}/merge_requests?state=opened&per_page=${Math.min(limit, 100)}`,
  );
  if (!response.ok || !response.data) {
    throw new Error(`Failed to list merge requests for project ${projectId} (HTTP ${response.status}).`);
  }
  return response.data.map((mr: any) => ({
    number: Number(mr.iid),
    title: mr.title ?? undefined,
    url: mr.web_url ?? undefined,
    author: mr.author?.username ?? undefined,
    isDraft: Boolean(mr.draft ?? mr.work_in_progress),
    state: 'open' as const,
    baseRef: mr.target_branch ?? undefined,
    headRef: mr.source_branch ?? undefined,
    headSha: mr.sha ?? undefined,
    reviewDecision: undefined,
    requestedReviewers: Array.isArray(mr.reviewers)
      ? mr.reviewers.map((reviewer: any) => String(reviewer.username))
      : [],
    mergeableState:
      mr.detailed_merge_status === 'mergeable'
        ? 'clean'
        : mr.has_conflicts
          ? 'dirty'
          : (mr.detailed_merge_status ?? undefined),
    checksStatus: undefined,
    createdAt: mr.created_at ?? undefined,
    updatedAt: mr.updated_at ?? undefined,
  }));
}

const PIPELINE_STATUS_MAP: Record<
  string,
  { status: PipelineRunSnapshot['status']; conclusion?: PipelineRunSnapshot['conclusion'] }
> = {
  success: { status: 'completed', conclusion: 'success' },
  failed: { status: 'completed', conclusion: 'failure' },
  canceled: { status: 'completed', conclusion: 'cancelled' },
  skipped: { status: 'completed', conclusion: 'skipped' },
  running: { status: 'in_progress' },
  pending: { status: 'queued' },
  created: { status: 'queued' },
  manual: { status: 'queued' },
};

export async function latestDefaultBranchPipeline(
  client: GitLabClient,
  projectId: string,
  defaultBranch: string,
): Promise<PipelineRunSnapshot | undefined> {
  const response = await client.request<any[]>(
    `/projects/${projectId}/pipelines?ref=${encodeURIComponent(defaultBranch)}&per_page=1&order_by=updated_at&sort=desc`,
  );
  if (!response.ok || !response.data) {
    if (response.status === 403 || response.status === 404) return undefined;
    throw new Error(`Failed to fetch pipelines for project ${projectId} (HTTP ${response.status}).`);
  }
  const pipeline = response.data[0];
  if (!pipeline) return undefined;
  const mapped = PIPELINE_STATUS_MAP[String(pipeline.status)] ?? { status: 'unknown' as const };
  return {
    externalId: String(pipeline.id),
    name: 'pipeline',
    status: mapped.status,
    conclusion: mapped.conclusion,
    branch: pipeline.ref ?? undefined,
    headSha: pipeline.sha ?? undefined,
    url: pipeline.web_url ?? undefined,
    runStartedAt: pipeline.created_at ?? undefined,
    completedAt: pipeline.updated_at ?? undefined,
  };
}

/**
 * Branch inventory with bounded comparisons. GitLab's compare API is
 * one-directional, so ahead/behind needs two calls per branch — the
 * comparison cap is therefore lower than GitHub's.
 */
export async function collectGitLabBranches(
  client: GitLabClient,
  projectId: string,
  defaultBranch: string,
  options: { maxBranches?: number; maxComparisons?: number; openChangeRequestHeads?: Set<string> } = {},
): Promise<BranchSnapshot[]> {
  const maxBranches = options.maxBranches ?? 100;
  const maxComparisons = options.maxComparisons ?? 3;
  const prHeads = options.openChangeRequestHeads ?? new Set<string>();

  const response = await client.request<any[]>(
    `/projects/${projectId}/repository/branches?per_page=${Math.min(maxBranches, 100)}`,
  );
  if (!response.ok || !response.data) {
    throw new Error(`Failed to list branches for project ${projectId} (HTTP ${response.status}).`);
  }

  const branches: BranchSnapshot[] = response.data.map((branch: any) => {
    const excluded = isExcludedBranchName(String(branch.name));
    return {
      name: String(branch.name),
      headSha: branch.commit?.id ?? undefined,
      headCommittedAt: branch.commit?.committed_date ?? undefined,
      isDefault: Boolean(branch.default) || branch.name === defaultBranch,
      isProtected: Boolean(branch.protected),
      comparisonStatus:
        branch.default || branch.name === defaultBranch
          ? ('identical' as const)
          : ('unknown' as const),
      excluded,
      excludedReason: excluded ? 'Matched instance branch exclusion pattern.' : undefined,
    };
  });

  const candidates = branches
    .filter((branch) => !branch.isDefault && !branch.excluded)
    .sort((a, b) => Number(prHeads.has(b.name)) - Number(prHeads.has(a.name)));

  for (const branch of candidates.slice(0, maxComparisons)) {
    const ahead = await client.request<{ commits?: any[] }>(
      `/projects/${projectId}/repository/compare?from=${encodeURIComponent(defaultBranch)}&to=${encodeURIComponent(branch.name)}`,
    );
    const behind = await client.request<{ commits?: any[] }>(
      `/projects/${projectId}/repository/compare?from=${encodeURIComponent(branch.name)}&to=${encodeURIComponent(defaultBranch)}`,
    );
    if (ahead.ok && behind.ok) {
      branch.aheadBy = ahead.data?.commits?.length ?? 0;
      branch.behindBy = behind.data?.commits?.length ?? 0;
      branch.comparisonStatus = classifyComparison(branch.aheadBy, branch.behindBy);
      branch.comparedAt = new Date().toISOString();
    }
  }

  return branches;
}
