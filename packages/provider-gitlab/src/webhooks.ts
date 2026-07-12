import type { DomainEvent, RepositoryRef } from '@repo-wrangler/contracts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** GitLab webhook event types RepoWrangler handles. */
export const HANDLED_GITLAB_EVENTS = new Set([
  'Push Hook',
  'Merge Request Hook',
  'Pipeline Hook',
]);

/**
 * GitLab authenticates webhooks with a shared secret token header, not an
 * HMAC signature. Constant-time comparison of the configured token.
 */
export function verifyGitLabToken(configured: string, header: string | null): boolean {
  if (!header || header.length !== configured.length) return false;
  let diff = 0;
  for (let i = 0; i < configured.length; i++) {
    diff |= configured.charCodeAt(i) ^ header.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * GitLab has no delivery ID header — build a deterministic idempotency
 * fingerprint from the event's own identifiers.
 */
export function gitlabDeliveryFingerprint(event: string, payload: any): string {
  const project = payload.project?.id ?? 'unknown';
  const marker =
    payload.after ??
    payload.object_attributes?.id ??
    payload.object_attributes?.iid ??
    payload.checkout_sha ??
    'na';
  const updated = payload.object_attributes?.updated_at ?? payload.object_attributes?.finished_at ?? '';
  return `gitlab:${event}:${project}:${marker}:${updated}`;
}

function refFromGitLabPayload(payload: any): RepositoryRef | undefined {
  const project = payload.project;
  if (!project) return undefined;
  return {
    workspaceExternalId: String(project.namespace_id ?? payload.group_id ?? 'unknown'),
    repositoryExternalId: String(project.id),
    fullName: String(project.path_with_namespace),
  };
}

/** Translate a validated GitLab webhook into compact domain events. */
export function translateGitLabEvent(event: string, payload: any): DomainEvent[] {
  if (!HANDLED_GITLAB_EVENTS.has(event)) return [];
  const ref = refFromGitLabPayload(payload);
  if (!ref) return [];
  const events: DomainEvent[] = [];

  switch (event) {
    case 'Push Hook': {
      const refName: string = payload.ref ?? '';
      if (!refName.startsWith('refs/heads/')) break;
      const branchName = refName.slice('refs/heads/'.length);
      const after = String(payload.after ?? '');
      if (/^0+$/.test(after)) {
        events.push({ type: 'branch.deleted', ref, branchName });
      } else {
        events.push({ type: 'branch.pushed', ref, branchName, headSha: after });
        events.push({
          type: 'sync.requested',
          jobType: 'enrich_repository',
          scope: ref.fullName,
          priority: 5,
        });
      }
      break;
    }
    case 'Merge Request Hook': {
      const mr = payload.object_attributes;
      if (!mr) break;
      let state: 'open' | 'merged' | 'closed' = 'open';
      if (mr.state === 'merged') state = 'merged';
      else if (mr.state === 'closed') state = 'closed';
      events.push({
        type: 'change_request.upsert',
        ref,
        changeRequest: {
          number: Number(mr.iid),
          title: mr.title ?? undefined,
          url: mr.url ?? undefined,
          author: payload.user?.username ?? undefined,
          isDraft: Boolean(mr.draft ?? mr.work_in_progress),
          state,
          baseRef: mr.target_branch ?? undefined,
          headRef: mr.source_branch ?? undefined,
          headSha: mr.last_commit?.id ?? undefined,
          requestedReviewers: [],
          mergeableState: mr.detailed_merge_status === 'mergeable' ? 'clean' : undefined,
          createdAt: mr.created_at ?? undefined,
          updatedAt: mr.updated_at ?? undefined,
          mergedAt: state === 'merged' ? (mr.updated_at ?? undefined) : undefined,
          closedAt: state === 'closed' ? (mr.updated_at ?? undefined) : undefined,
        },
      });
      break;
    }
    case 'Pipeline Hook': {
      const pipeline = payload.object_attributes;
      if (!pipeline) break;
      const statusMap: Record<string, { status: 'queued' | 'in_progress' | 'completed' | 'unknown'; conclusion?: string }> = {
        success: { status: 'completed', conclusion: 'success' },
        failed: { status: 'completed', conclusion: 'failure' },
        canceled: { status: 'completed', conclusion: 'cancelled' },
        skipped: { status: 'completed', conclusion: 'skipped' },
        running: { status: 'in_progress' },
        pending: { status: 'queued' },
      };
      const mapped = statusMap[String(pipeline.status)] ?? { status: 'unknown' as const };
      events.push({
        type: 'pipeline_run.upsert',
        ref,
        run: {
          externalId: String(pipeline.id),
          name: 'pipeline',
          status: mapped.status,
          conclusion: mapped.conclusion as any,
          branch: pipeline.ref ?? undefined,
          headSha: pipeline.sha ?? undefined,
          url: payload.project?.web_url ? `${payload.project.web_url}/-/pipelines/${pipeline.id}` : undefined,
          runStartedAt: pipeline.created_at ?? undefined,
          completedAt: pipeline.finished_at ?? undefined,
          durationSeconds: typeof pipeline.duration === 'number' ? pipeline.duration : undefined,
        },
      });
      break;
    }
    default:
      break;
  }

  return events;
}
