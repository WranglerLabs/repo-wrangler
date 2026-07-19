import { authMode, isDemoMode, type Env } from '../bindings';
import { getMeta } from '@repo-wrangler/persistence-d1';
import { setupWasCompleted } from '../lib/setup-state';
import type { AuthProvider } from './types';
import { githubProvider } from './github';
import { gitlabProvider } from './gitlab';
import { entraProvider } from './entra';
import { googleProvider } from './google';
import { localProvider } from './local';

/**
 * The authentication provider registry (ADR-019, PN-5).
 *
 * Selection is two steps: which providers the operator *enabled*, then which of
 * those are actually *configured*. `AUTH_PROVIDERS` (an ordered CSV of provider
 * ids) is the modern control; when it is unset the legacy `AUTH_MODE` selects a
 * single provider so existing deployments keep working. The `local` dev provider
 * is only ever available when explicitly named in `AUTH_PROVIDERS` — it is never
 * reachable through the `AUTH_MODE` fallback.
 */
export const ALL_PROVIDERS: readonly AuthProvider[] = [
  githubProvider,
  gitlabProvider,
  entraProvider,
  googleProvider,
  localProvider,
];

const BY_ID = new Map(ALL_PROVIDERS.map((p) => [p.id, p]));

/** Ordered ids the operator enabled, before the configuration filter. */
async function enabledIds(env: Env): Promise<AuthProvider['id'][]> {
  const stored = await getMeta(env.DB, 'auth.enabled_providers');
  if (stored) return parseEnabledIds(stored);
  const raw = (env.AUTH_PROVIDERS ?? '').trim();
  if (raw) return parseEnabledIds(raw);
  // Legacy single-provider fallback — never yields `local`.
  return authMode(env) === 'entra' ? ['entra'] : ['github'];
}

function parseEnabledIds(raw: string): AuthProvider['id'][] {
  const ids: AuthProvider['id'][] = [];
  for (const token of raw.split(',').map((value) => value.trim().toLowerCase())) {
    const provider = BY_ID.get(token as AuthProvider['id']);
    if (provider && !ids.includes(provider.id)) ids.push(provider.id);
  }
  return ids;
}

/**
 * Enabled *and* configured providers, in operator-specified order. Async
 * because `isConfigured` may resolve wizard-stored DB credentials (GitHub,
 * ADR-019 PN-5) rather than just reading `env` synchronously.
 */
export async function enabledProviders(env: Env): Promise<AuthProvider[]> {
  const candidates = (await enabledIds(env))
    .map((id) => BY_ID.get(id))
    .filter((p): p is AuthProvider => Boolean(p));
  const configured = await Promise.all(candidates.map((p) => p.isConfigured(env)));
  return candidates.filter((_, i) => configured[i]);
}

/**
 * First boot may use the setup allowlist until a real sign-in succeeds once. The
 * durable latch prevents provider removal from ever reopening setup against a
 * populated instance.
 */
export async function isSetupMode(env: Env): Promise<boolean> {
  if (isDemoMode(env)) return false;
  return !(await setupWasCompleted(env.DB));
}

/** Session issuers must remain both enabled and configured for their cookies to stay valid. */
export async function isSessionProviderEnabled(
  env: Env,
  providerId: string | undefined,
): Promise<boolean> {
  if (!providerId || providerId === 'setup' || providerId === 'demo') return false;
  return (await enabledProviders(env)).some((provider) => provider.id === providerId);
}

export interface AuthConfigDto {
  demo: boolean;
  providers: { id: string; label: string; loginUrl: string }[];
}

/**
 * Public sign-in configuration for the SPA: one entry per enabled+configured
 * provider so the login screen renders a button for each, with no session.
 */
export async function authConfig(env: Env): Promise<AuthConfigDto> {
  const providers = await enabledProviders(env);
  return {
    demo: isDemoMode(env),
    providers: providers.map((p) => ({
      id: p.id,
      label: p.label,
      loginUrl: `/auth/${p.id}/login`,
    })),
  };
}
