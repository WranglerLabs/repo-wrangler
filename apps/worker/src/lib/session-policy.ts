import type { SessionPolicyDto, SessionPolicyUpdateDto } from '@repo-wrangler/contracts';
import { getMeta, setMeta } from '@repo-wrangler/persistence-d1';

const META_KEY = 'auth.session_policy';
const DEFAULT_TIMEOUT_MINUTES = 12 * 60;

function fixed(timeoutMinutes: number, source: SessionPolicyDto['source']): SessionPolicyDto {
  return { mode: 'fixed', timeoutMinutes, source };
}

function parseTimeoutMinutes(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 525_600) return null;
  return parsed;
}

function parseStored(value: string | null): SessionPolicyDto | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { mode?: unknown; timeoutMinutes?: unknown };
    if (parsed.mode === 'browser') {
      return { mode: 'browser', timeoutMinutes: null, source: 'stored' };
    }
    if (parsed.mode === 'fixed') {
      const timeoutMinutes = parseTimeoutMinutes(parsed.timeoutMinutes);
      return timeoutMinutes === null ? null : fixed(timeoutMinutes, 'stored');
    }
  } catch {
    // Ignore malformed state and fall back to deployment/default policy.
  }
  return null;
}

/** Resolve durable policy first, then the portable deployment default, then 12 hours. */
export async function resolveSessionPolicy(
  db: D1Database,
  configuredTimeoutMinutes: string | undefined,
): Promise<SessionPolicyDto> {
  const stored = parseStored(await getMeta(db, META_KEY));
  if (stored) return stored;

  if (configuredTimeoutMinutes?.trim() === '0') {
    return { mode: 'browser', timeoutMinutes: null, source: 'deployment' };
  }
  const configured = parseTimeoutMinutes(configuredTimeoutMinutes);
  if (configured !== null) return fixed(configured, 'deployment');
  return fixed(DEFAULT_TIMEOUT_MINUTES, 'default');
}

export async function saveSessionPolicy(
  db: D1Database,
  policy: SessionPolicyUpdateDto,
): Promise<SessionPolicyDto> {
  const normalized = policy.mode === 'browser'
    ? { mode: 'browser' as const, timeoutMinutes: null }
    : { mode: 'fixed' as const, timeoutMinutes: policy.timeoutMinutes };
  await setMeta(db, META_KEY, JSON.stringify(normalized));
  return { ...normalized, source: 'stored' };
}
