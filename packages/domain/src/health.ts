import type {
  ChangeRequestSnapshot,
  GovernanceInfo,
  PipelineRunSnapshot,
  RepositorySnapshot,
  SecurityFindingSnapshot,
  BranchSnapshot,
} from './entities';
import { evaluateDefaultBranchStatus } from './branch-status';
import type { CapabilityResult } from './capabilities';

/**
 * Explainable, rule-based health evaluation. No opaque score: the finding
 * list is authoritative and every attention level traces to a rule.
 */
export type AttentionLevel =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'healthy'
  | 'unknown';

export const ATTENTION_ORDER: AttentionLevel[] = [
  'critical',
  'high',
  'medium',
  'low',
  'healthy',
  'unknown',
];

export interface HealthFinding {
  code: string;
  severity: Exclude<AttentionLevel, 'healthy' | 'unknown'> | 'info';
  message: string;
}

export interface RepositoryHealthInput {
  repository: RepositorySnapshot;
  branches: BranchSnapshot[];
  latestDefaultBranchRun?: PipelineRunSnapshot;
  openChangeRequests: ChangeRequestSnapshot[];
  securityFindings: CapabilityResult<SecurityFindingSnapshot[]>;
  /** Optional governance evaluation input (Phase 3). */
  governance?: CapabilityResult<GovernanceInfo>;
  /** Days without a push before a repo counts as inactive. */
  staleRepositoryDays?: number;
  /** Days an open change request may sit unmerged before it is stale. */
  staleChangeRequestDays?: number;
  now?: Date;
}

export interface RepositoryHealth {
  level: AttentionLevel;
  findings: HealthFinding[];
  policyVersion: string;
}

export const POLICY_VERSION = '2026.07-1';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return (now.getTime() - t) / DAY_MS;
}

function severityToLevel(findings: HealthFinding[]): AttentionLevel {
  for (const level of ['critical', 'high', 'medium', 'low'] as const) {
    if (findings.some((f) => f.severity === level)) return level;
  }
  return 'healthy';
}

export function evaluateRepositoryHealth(
  input: RepositoryHealthInput,
): RepositoryHealth {
  const now = input.now ?? new Date();
  const staleRepoDays = input.staleRepositoryDays ?? 180;
  const staleCrDays = input.staleChangeRequestDays ?? 21;
  const findings: HealthFinding[] = [];
  const repo = input.repository;

  if (repo.isArchived) {
    return {
      level: 'healthy',
      findings: [
        { code: 'repo.archived', severity: 'info', message: 'Repository is archived; policy checks skipped.' },
      ],
      policyVersion: POLICY_VERSION,
    };
  }

  // Security — critical/high signals first.
  if (input.securityFindings.state === 'available') {
    const open = (input.securityFindings.data ?? []).filter(
      (f) => f.state === 'open' || f.state === undefined,
    );
    const secrets = open.filter((f) => f.category === 'secret_scanning');
    if (secrets.length > 0) {
      findings.push({
        code: 'security.secret_exposure',
        severity: 'critical',
        message: `${secrets.length} open secret scanning alert(s).`,
      });
    }
    const highSev = open.filter(
      (f) => f.category !== 'secret_scanning' && (f.severity === 'critical' || f.severity === 'high'),
    );
    if (highSev.length > 0) {
      findings.push({
        code: 'security.high_severity',
        severity: 'high',
        message: `${highSev.length} open high/critical security finding(s).`,
      });
    }
  }

  // Delivery — default branch pipeline state.
  const run = input.latestDefaultBranchRun;
  if (run && run.status === 'completed') {
    if (run.conclusion === 'failure' || run.conclusion === 'timed_out') {
      findings.push({
        code: 'delivery.default_branch_failing',
        severity: 'high',
        message: `Latest default-branch run "${run.name ?? run.externalId}" concluded ${run.conclusion}.`,
      });
    } else if (run.conclusion === 'cancelled') {
      findings.push({
        code: 'delivery.default_branch_cancelled',
        severity: 'medium',
        message: 'Latest default-branch run was cancelled.',
      });
    }
  }

  // Branch hygiene.
  const branchEval = evaluateDefaultBranchStatus(input.branches);
  if (branchEval.status === 'diverged') {
    findings.push({
      code: 'branches.diverged',
      severity: 'medium',
      message: branchEval.reasons[0] ?? 'An active branch has diverged from the default branch.',
    });
  } else if (branchEval.status === 'untracked_work') {
    findings.push({
      code: 'branches.untracked_work',
      severity: 'medium',
      message: branchEval.reasons[0] ?? 'An active branch is ahead without a change request.',
    });
  } else if (branchEval.status === 'work_pending') {
    findings.push({
      code: 'branches.work_pending',
      severity: 'info',
      message: branchEval.reasons[0] ?? 'Work is ahead of the default branch with an open change request.',
    });
  }

  // Change flow — stale/blocked open change requests.
  for (const cr of input.openChangeRequests) {
    if (cr.state !== 'open') continue;
    const age = daysSince(cr.updatedAt ?? cr.createdAt, now);
    const blocked = cr.mergeableState === 'dirty' || cr.mergeableState === 'blocked';
    if (blocked && age !== undefined && age >= staleCrDays) {
      findings.push({
        code: 'change_flow.stale_blocked',
        severity: 'medium',
        message: `#${cr.number} "${cr.title ?? ''}" has been ${cr.mergeableState === 'dirty' ? 'conflicted' : 'blocked'} for ${Math.floor(age)} day(s).`,
      });
    } else if (age !== undefined && age >= staleCrDays * 2) {
      findings.push({
        code: 'change_flow.stale',
        severity: 'low',
        message: `#${cr.number} "${cr.title ?? ''}" has had no activity for ${Math.floor(age)} day(s).`,
      });
    }
  }

  // Governance — protection and hygiene drift.
  if (input.governance?.state === 'available' && input.governance.data) {
    const governance = input.governance.data;
    if (governance.defaultBranchProtected === false && repo.visibility !== 'public') {
      findings.push({
        code: 'governance.unprotected_default_branch',
        severity: 'medium',
        message: 'Default branch has no branch protection or ruleset.',
      });
    } else if (governance.defaultBranchProtected === false) {
      findings.push({
        code: 'governance.unprotected_default_branch',
        severity: 'low',
        message: 'Default branch has no branch protection or ruleset.',
      });
    }
    const missing: string[] = [];
    if (governance.files?.readme === false) missing.push('README');
    if (governance.files?.license === false) missing.push('license');
    if (missing.length > 0) {
      findings.push({
        code: 'governance.missing_files',
        severity: 'low',
        message: `Missing repository hygiene files: ${missing.join(', ')}.`,
      });
    }
  }

  // Activity — abandonment candidates.
  const inactivity = daysSince(repo.pushedAt, now);
  if (inactivity !== undefined && inactivity >= staleRepoDays) {
    findings.push({
      code: 'activity.inactive',
      severity: 'low',
      message: `No push in ${Math.floor(inactivity)} day(s); archive candidate.`,
    });
  }

  const hasUnknownOnly =
    findings.length === 0 &&
    branchEval.status === 'unknown' &&
    input.securityFindings.state !== 'available' &&
    !run;

  return {
    level: hasUnknownOnly ? 'unknown' : severityToLevel(findings),
    findings,
    policyVersion: POLICY_VERSION,
  };
}
