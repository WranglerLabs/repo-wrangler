import type { Context } from 'hono';
import type { Hono } from 'hono';
import { recordAuditEvent } from '@repo-wrangler/persistence-d1';
import type { Env } from '../bindings';
import type { AppContext } from '../middleware/auth';
import { createSessionCookie } from '../lib/session';

/**
 * `IAuthenticationProvider` — the sign-in seam (ADR-019, PN-5).
 *
 * Every identity source (GitHub, GitLab, Entra, Google, local-dev) implements
 * this shape: a stable `id`, a display `label` for the SPA button, a
 * configuration check, and a Hono router mounting its `/{id}/login` and
 * `/{id}/callback` routes under `/auth`. All of them converge on one signed
 * session cookie via {@link completeSignIn}, so nothing downstream — middleware,
 * roles, `/auth/me` — knows or cares which provider was used. Business logic
 * never references a specific IdP; the registry selects which are enabled.
 */
export interface AuthProvider {
  readonly id: 'github' | 'gitlab' | 'entra' | 'google' | 'local';
  /** Display name for the sign-in button (e.g. "GitHub", "Microsoft"). */
  readonly label: string;
  /** True when this provider has every setting it needs to run. */
  isConfigured(env: Env): boolean;
  /** Routes mounted under `/auth` (so paths begin `/{id}/...`). */
  readonly routes: Hono<AppContext>;
}

/**
 * Map a verified identity to a role against a comma-separated allowlist. The
 * first listed principal is the owner; the rest are admins; anyone not listed is
 * rejected. Shared by every provider so the ownership rule is identical.
 */
export function allowlistedRole(
  identity: string,
  allowed: string | undefined,
): 'owner' | 'admin' | null {
  const names = (allowed ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  const index = names.findIndex((u) => u.toLowerCase() === identity.toLowerCase());
  if (index === -1) return null;
  return index === 0 ? 'owner' : 'admin';
}

/**
 * Finish a sign-in: enforce the allowlist, audit the outcome, issue the shared
 * session cookie, and redirect home. Providers call this once they have a
 * verified identity, having already appended any `Set-Cookie` headers that clear
 * their own transient state/nonce cookies.
 */
export async function completeSignIn(
  c: Context<AppContext>,
  opts: { provider: AuthProvider['id']; identity: string; allowedUsers: string | undefined },
): Promise<Response> {
  const secret = c.env.SESSION_SECRET;
  if (!secret) return c.json({ error: 'SESSION_SECRET is not configured.' }, 500);

  const role = allowlistedRole(opts.identity, opts.allowedUsers);
  if (!role) {
    await recordAuditEvent(c.env.DB, opts.identity, 'login.denied', `provider=${opts.provider}`);
    return c.json({ error: 'This account is not authorized for this instance.' }, 403);
  }
  await recordAuditEvent(
    c.env.DB,
    opts.identity,
    'login.success',
    `provider=${opts.provider} role=${role}`,
  );
  const cookie = await createSessionCookie(secret, { login: opts.identity, role }, true);
  c.header('Set-Cookie', cookie, { append: true });
  return c.redirect('/');
}

/** Read a single cookie value from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** A short-lived, HttpOnly, Lax cookie scoped to `/auth` for OAuth state/nonce. */
export function transientCookie(name: string, value: string): string {
  return `${name}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure`;
}

/** Expire a transient cookie set by {@link transientCookie}. */
export function clearTransientCookie(name: string): string {
  return `${name}=; Path=/auth; HttpOnly; Max-Age=0`;
}

/** Decode a JWT payload without verifying the signature (back-channel tokens). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts.length === 3 ? parts[1] : undefined;
  if (!payload) return null;
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}
