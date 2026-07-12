import type {
  ChangeRequestSnapshot,
  PipelineRunSnapshot,
  RepositorySnapshot,
  WorkspaceSnapshot,
} from '@repo-wrangler/domain';
import type { GitHubInstallation } from './app';

/**
 * Map raw GitHub REST payloads to provider-neutral domain snapshots.
 * These are the only places raw GitHub shapes are read.
 */

// Intentionally loose input types: GitHub payloads vary by endpoint/event and
// are validated field-by-field here at the boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */

export function mapInstallationToWorkspace(installation: GitHubInstallation): WorkspaceSnapshot {
  const account = installation.account;
  return {
    externalId: String(account?.id ?? installation.id),
    installationId: String(installation.id),
    slug: account?.login ?? `installation-${installation.id}`,
    displayName: account?.login,
    kind: account?.type === 'User' ? 'user' : 'organization',
    avatarUrl: account?.avatar_url,
  };
}

export function mapRepository(repo: any): RepositorySnapshot {
  return {
    externalId: String(repo.id),
    nodeId: repo.node_id ?? undefined,
    name: String(repo.name),
    fullName: String(repo.full_name),
    url: repo.html_url ?? undefined,
    description: repo.description ?? undefined,
    visibility: repo.visibility ?? (repo.private ? 'private' : 'public'),
    isArchived: Boolean(repo.archived),
    isFork: Boolean(repo.fork),
    isDisabled: Boolean(repo.disabled),
    isTemplate: Boolean(repo.is_template),
    defaultBranch: repo.default_branch ?? undefined,
    pushedAt: repo.pushed_at ?? undefined,
    providerUpdatedAt: repo.updated_at ?? undefined,
    primaryLanguage: repo.language ?? undefined,
    topics: Array.isArray(repo.topics) ? repo.topics.map(String) : [],
    licenseSpdx: repo.license?.spdx_id ?? undefined,
    sizeKb: typeof repo.size === 'number' ? repo.size : undefined,
  };
}

export function mapWorkflowRun(run: any): PipelineRunSnapshot {
  const started = run.run_started_at ?? run.created_at;
  const completed = run.status === 'completed' ? run.updated_at : undefined;
  let durationSeconds: number | undefined;
  if (started && completed) {
    const ms = Date.parse(completed) - Date.parse(started);
    if (!Number.isNaN(ms) && ms >= 0) durationSeconds = Math.round(ms / 1000);
  }
  return {
    externalId: String(run.id),
    name: run.name ?? run.workflow_name ?? undefined,
    status:
      run.status === 'completed' || run.status === 'in_progress' || run.status === 'queued'
        ? run.status
        : 'unknown',
    conclusion: run.conclusion ?? undefined,
    branch: run.head_branch ?? undefined,
    headSha: run.head_sha ?? undefined,
    event: run.event ?? undefined,
    actor: run.actor?.login ?? undefined,
    url: run.html_url ?? undefined,
    runStartedAt: started ?? undefined,
    completedAt: completed ?? undefined,
    durationSeconds,
    attempt: typeof run.run_attempt === 'number' ? run.run_attempt : undefined,
  };
}

export function mapPullRequest(pr: any): ChangeRequestSnapshot {
  let state: ChangeRequestSnapshot['state'] = 'open';
  if (pr.merged_at) state = 'merged';
  else if (pr.state === 'closed') state = 'closed';
  return {
    number: Number(pr.number),
    title: pr.title ?? undefined,
    url: pr.html_url ?? undefined,
    author: pr.user?.login ?? undefined,
    isDraft: Boolean(pr.draft),
    state,
    baseRef: pr.base?.ref ?? undefined,
    headRef: pr.head?.ref ?? undefined,
    headSha: pr.head?.sha ?? undefined,
    reviewDecision: undefined,
    requestedReviewers: Array.isArray(pr.requested_reviewers)
      ? pr.requested_reviewers.map((r: any) => String(r.login))
      : [],
    mergeableState: pr.mergeable_state ?? undefined,
    checksStatus: undefined,
    createdAt: pr.created_at ?? undefined,
    updatedAt: pr.updated_at ?? undefined,
    mergedAt: pr.merged_at ?? undefined,
    closedAt: pr.closed_at ?? undefined,
  };
}
