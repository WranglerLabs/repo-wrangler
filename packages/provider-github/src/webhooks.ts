import type { DomainEvent, RepositoryRef } from '@repo-wrangler/contracts';
import { classifyComparison } from '@repo-wrangler/domain';
import { mapPullRequest, mapRepository, mapWorkflowRun } from './mappers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Events RepoWrangler subscribes to; everything else is acknowledged and dropped. */
export const HANDLED_EVENTS = new Set([
  'installation',
  'installation_repositories',
  'repository',
  'push',
  'create',
  'delete',
  'pull_request',
  'workflow_run',
  'code_scanning_alert',
  'dependabot_alert',
  'secret_scanning_alert',
]);

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Validate X-Hub-Signature-256 over the raw body. */
export async function verifyGitHubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = hexToBytes(signatureHeader.slice('sha256='.length));
  if (!expected) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return timingSafeEqual(new Uint8Array(mac), expected);
}

function refFromPayload(payload: any): RepositoryRef | undefined {
  const repo = payload.repository;
  if (!repo) return undefined;
  const ownerId = repo.owner?.id ?? payload.organization?.id;
  if (ownerId === undefined) return undefined;
  return {
    workspaceExternalId: String(ownerId),
    repositoryExternalId: String(repo.id),
    fullName: String(repo.full_name),
  };
}

/**
 * Translate a validated GitHub webhook into compact domain events.
 * Returns [] for events that carry nothing RepoWrangler stores.
 */
export function translateGitHubEvent(event: string, payload: any): DomainEvent[] {
  if (!HANDLED_EVENTS.has(event)) return [];
  const events: DomainEvent[] = [];
  const ref = refFromPayload(payload);

  switch (event) {
    case 'installation': {
      // created/deleted/suspend — always worth a discovery pass.
      events.push({
        type: 'sync.requested',
        jobType: 'discovery',
        scope: 'all',
        priority: 3,
      });
      break;
    }
    case 'installation_repositories': {
      for (const repo of payload.repositories_added ?? []) {
        const account = payload.installation?.account;
        if (!account) continue;
        events.push({
          type: 'repository.upsert',
          ref: {
            workspaceExternalId: String(account.id),
            repositoryExternalId: String(repo.id),
            fullName: String(repo.full_name),
          },
          repository: mapRepository({ ...repo, private: repo.private }),
        });
      }
      for (const repo of payload.repositories_removed ?? []) {
        const account = payload.installation?.account;
        if (!account) continue;
        events.push({
          type: 'repository.removed',
          ref: {
            workspaceExternalId: String(account.id),
            repositoryExternalId: String(repo.id),
            fullName: String(repo.full_name),
          },
        });
      }
      break;
    }
    case 'repository': {
      if (!ref) break;
      if (payload.action === 'deleted') {
        events.push({ type: 'repository.removed', ref });
      } else {
        events.push({ type: 'repository.upsert', ref, repository: mapRepository(payload.repository) });
      }
      break;
    }
    case 'push': {
      if (!ref) break;
      const refName: string = payload.ref ?? '';
      if (!refName.startsWith('refs/heads/')) break;
      const branchName = refName.slice('refs/heads/'.length);
      if (payload.deleted) {
        events.push({ type: 'branch.deleted', ref, branchName });
      } else {
        events.push({
          type: 'branch.pushed',
          ref,
          branchName,
          headSha: String(payload.after ?? ''),
          pushedAt: payload.head_commit?.timestamp ?? undefined,
        });
        // A push invalidates comparisons; request a narrow enrichment.
        events.push({
          type: 'sync.requested',
          jobType: 'enrich_repository',
          scope: ref.fullName,
          priority: 5,
        });
      }
      break;
    }
    case 'create':
    case 'delete': {
      if (!ref || payload.ref_type !== 'branch') break;
      if (event === 'delete') {
        events.push({ type: 'branch.deleted', ref, branchName: String(payload.ref) });
      } else {
        events.push({
          type: 'branch.upsert',
          ref,
          branch: {
            name: String(payload.ref),
            isDefault: payload.ref === payload.repository?.default_branch,
            isProtected: false,
            comparisonStatus: classifyComparison(undefined, undefined),
            excluded: false,
          },
        });
      }
      break;
    }
    case 'pull_request': {
      if (!ref) break;
      events.push({ type: 'change_request.upsert', ref, changeRequest: mapPullRequest(payload.pull_request) });
      break;
    }
    case 'workflow_run': {
      if (!ref) break;
      events.push({ type: 'pipeline_run.upsert', ref, run: mapWorkflowRun(payload.workflow_run) });
      break;
    }
    case 'code_scanning_alert':
    case 'dependabot_alert':
    case 'secret_scanning_alert': {
      if (!ref) break;
      const alert = payload.alert;
      if (!alert) break;
      const category =
        event === 'code_scanning_alert'
          ? ('code_scanning' as const)
          : event === 'dependabot_alert'
            ? ('dependency' as const)
            : ('secret_scanning' as const);
      events.push({
        type: 'security_finding.upsert',
        ref,
        finding: {
          externalId: String(alert.number ?? alert.id ?? ''),
          category,
          severity:
            alert.rule?.security_severity_level ??
            alert.security_advisory?.severity ??
            undefined,
          state: alert.state ?? undefined,
          ruleId: alert.rule?.id ?? alert.secret_type ?? undefined,
          ref: alert.most_recent_instance?.ref ?? undefined,
          url: alert.html_url ?? undefined,
          // Deliberately compact and redacted — no secret content, no snippets.
          summary: alert.rule?.description ?? alert.secret_type_display_name ?? undefined,
          createdAt: alert.created_at ?? undefined,
          updatedAt: alert.updated_at ?? undefined,
          resolvedAt: alert.fixed_at ?? alert.resolved_at ?? alert.dismissed_at ?? undefined,
        },
      });
      break;
    }
    default:
      break;
  }

  return events;
}
