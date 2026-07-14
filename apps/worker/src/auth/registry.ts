import { authMode, isDemoMode, type Env } from '../bindings';
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
function enabledIds(env: Env): AuthProvider['id'][] {
  const raw = (env.AUTH_PROVIDERS ?? '').trim();
  if (raw) {
    const ids: AuthProvider['id'][] = [];
    for (const token of raw.split(',').map((t) => t.trim().toLowerCase())) {
      const provider = BY_ID.get(token as AuthProvider['id']);
      if (provider && !ids.includes(provider.id)) ids.push(provider.id);
    }
    return ids;
  }
  // Legacy single-provider fallback — never yields `local`.
  return authMode(env) === 'entra' ? ['entra'] : ['github'];
}

/**
 * Enabled *and* configured providers, in operator-specified order. Async
 * because `isConfigured` may resolve wizard-stored DB credentials (GitHub,
 * ADR-019 PN-5) rather than just reading `env` synchronously.
 */
export async function enabledProviders(env: Env): Promise<AuthProvider[]> {
  const candidates = enabledIds(env)
    .map((id) => BY_ID.get(id))
    .filter((p): p is AuthProvider => Boolean(p));
  const configured = await Promise.all(candidates.map((p) => p.isConfigured(env)));
  return candidates.filter((_, i) => configured[i]);
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
