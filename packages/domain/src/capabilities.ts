/**
 * Provider capability model. Every provider adapter reports one of these
 * states at connection, workspace, and repository level. The UI must never
 * convert missing data into a false zero — "0 budgets" is different from
 * "budget API unavailable".
 */
export const CAPABILITY_STATES = [
  'available',
  'not_configured',
  'not_authorized',
  'unsupported_by_provider',
  'unsupported_by_plan',
  'temporarily_unavailable',
  'rate_limited',
  'error',
] as const;

export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export interface CapabilityResult<T> {
  state: CapabilityState;
  data?: T;
  detail?: string;
  observedAt: string;
}

export function capabilityAvailable<T>(data: T): CapabilityResult<T> {
  return { state: 'available', data, observedAt: new Date().toISOString() };
}

export function capabilityUnavailable<T>(
  state: Exclude<CapabilityState, 'available'>,
  detail?: string,
): CapabilityResult<T> {
  return { state, detail, observedAt: new Date().toISOString() };
}

/**
 * Map an HTTP error status from a provider API to a capability state.
 *
 * `rateLimited` covers GitHub's secondary rate limits, which surface as a
 * plain 403 (not 429) accompanied by a Retry-After header or
 * x-ratelimit-remaining: 0 — a transient condition, not a real
 * authorization failure, so it must not disable the capability.
 */
export function capabilityStateFromHttpStatus(
  status: number,
  options: { rateLimited?: boolean } = {},
): Exclude<CapabilityState, 'available'> {
  if (status === 403 && options.rateLimited) return 'rate_limited';
  if (status === 401 || status === 403) return 'not_authorized';
  if (status === 404) return 'unsupported_by_provider';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'temporarily_unavailable';
  return 'error';
}
