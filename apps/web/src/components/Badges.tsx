import { CAPABILITY_LABELS } from '../lib/format';

export function AttentionBadge({ level }: { level: string }) {
  return <span className={`badge ${level}`}>{level}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge ${severity}`}>{severity.toUpperCase()}</span>;
}

export function RunBadge({ conclusion, at }: { conclusion?: string; at?: string }) {
  if (!conclusion) return <span className="capability">no runs observed</span>;
  const cls =
    conclusion === 'success'
      ? 'healthy'
      : conclusion === 'failure' || conclusion === 'timed_out'
        ? 'critical'
        : conclusion === 'cancelled'
          ? 'medium'
          : 'unknown';
  return (
    <span title={at}>
      <span className={`badge ${cls}`}>{conclusion}</span>
    </span>
  );
}

export function BranchStatusBadge({ status }: { status: string }) {
  const labels: Record<string, { text: string; cls: string }> = {
    current: { text: 'current', cls: 'healthy' },
    work_pending: { text: 'work pending', cls: 'info' },
    untracked_work: { text: 'untracked work', cls: 'medium' },
    diverged: { text: 'diverged', cls: 'high' },
    unknown: { text: 'unknown', cls: 'unknown' },
  };
  const entry = labels[status] ?? { text: status, cls: 'unknown' };
  return <span className={`badge ${entry.cls}`}>{entry.text}</span>;
}

/** Capability states render as explicit text — never as a false zero. */
export function CapabilityText({ state, count }: { state: string; count?: number }) {
  if (state === 'available') return <>{count ?? 0}</>;
  return <span className="capability">{CAPABILITY_LABELS[state] ?? state}</span>;
}
