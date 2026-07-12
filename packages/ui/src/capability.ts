/**
 * Framework-agnostic presentation for the capability model. Keeping this here
 * (not inside the React app) means any UI — the SPA, a future native shell, a
 * CLI — labels "not authorized" vs "0 results" the same honest way (the core
 * rule from the capability model: never render missing data as a false zero).
 */
import type { CapabilityState } from '@repo-wrangler/domain';

export interface CapabilityPresentation {
  /** Short human label. */
  label: string;
  /** Semantic tone for theming (maps to a color in tokens.ts). */
  tone: 'ok' | 'muted' | 'warn' | 'error';
  /** True when the value shown is real data rather than an unavailability state. */
  hasData: boolean;
}

export const CAPABILITY_PRESENTATION: Record<CapabilityState, CapabilityPresentation> = {
  available: { label: 'Available', tone: 'ok', hasData: true },
  not_configured: { label: 'Not configured', tone: 'muted', hasData: false },
  not_authorized: { label: 'Not authorized', tone: 'warn', hasData: false },
  unsupported_by_provider: { label: 'Unsupported by provider', tone: 'muted', hasData: false },
  unsupported_by_plan: { label: 'Unsupported on plan', tone: 'muted', hasData: false },
  temporarily_unavailable: { label: 'Temporarily unavailable', tone: 'warn', hasData: false },
  rate_limited: { label: 'Rate limited', tone: 'warn', hasData: false },
  error: { label: 'Error', tone: 'error', hasData: false },
};

export function presentCapability(state: CapabilityState): CapabilityPresentation {
  return CAPABILITY_PRESENTATION[state];
}
