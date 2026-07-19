import type { Context, Next } from 'hono';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { isDemoMode, type Env } from '../bindings';
import { readSession } from '../lib/session';
import { isSessionProviderEnabled, isSetupMode } from '../auth/registry';

export type AppContext = {
  Bindings: Env;
  Variables: {
    user: SessionUserDto;
    /**
     * Per-request CSP nonce (set by `securityHeaders` before the route runs).
     * Route handlers that emit an inline `<script>` — e.g. `setup/manifest.ts`
     * — must stamp it onto that tag (`nonce="${c.get('cspNonce')}"`) so the
     * script actually executes under the strict `script-src` below.
     */
    cspNonce: string;
  };
};

/**
 * Require an authenticated session for API routes. Demo mode auto-issues a
 * synthetic viewer identity so the product works before any secret exists.
 */
export async function requireAuth(c: Context<AppContext>, next: Next): Promise<Response | void> {
  if (isDemoMode(c.env)) {
    c.set('user', { login: 'demo', role: 'viewer', provider: 'demo', demo: true });
    return next();
  }

  const secret = c.env.SESSION_SECRET;
  const user = secret ? await readSession(secret, c.req.header('cookie')) : null;
  if (user && (await isSessionProviderEnabled(c.env, user.provider))) {
    c.set('user', user);
    return next();
  }

  if (isSetupRoute(c.req.method, c.req.path) && (await isSetupMode(c.env))) {
    if (c.env.SETUP_TOKEN) {
      const supplied = c.req.header('x-setup-token') ?? '';
      if (!(await constantTimeTokenEqual(supplied, c.env.SETUP_TOKEN))) {
        return c.json({ error: 'invalid setup token' }, 401);
      }
    }
    c.set('user', { login: 'setup', role: 'owner', provider: 'setup' });
    return next();
  }

  if (!secret) return c.json({ error: 'SESSION_SECRET is not configured.' }, 500);
  return c.json({ error: 'unauthenticated' }, 401);
}

const SETUP_ROUTES: readonly [string, RegExp][] = [
  ['GET', /^\/api\/v1\/onboarding\/status$/],
  ['POST', /^\/api\/v1\/identity\/configure$/],
  ['GET', /^\/api\/v1\/identity\/configuration$/],
  ['GET', /^\/api\/v1\/connections$/],
  ['POST', /^\/api\/v1\/connections\/github\/(exchange|credentials)$/],
  ['POST', /^\/api\/v1\/connections\/gitlab$/],
  ['GET', /^\/api\/v1\/connections\/[^/]+\/workspaces$/],
  ['GET', /^\/api\/v1\/connections\/[^/]+\/search-groups$/],
  ['POST', /^\/api\/v1\/connections\/[^/]+\/workspaces$/],
  ['PATCH', /^\/api\/v1\/workspaces\/[^/]+$/],
];

export function isSetupRoute(method: string, path: string): boolean {
  return SETUP_ROUTES.some(([allowedMethod, pattern]) =>
    allowedMethod === method.toUpperCase() && pattern.test(path),
  );
}

/** Hash both values first so even unequal-length tokens take the same comparison path. */
async function constantTimeTokenEqual(supplied: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Require the admin or owner role (mutating admin endpoints).
 *
 * Generic over the route path so Hono's multi-handler overloads can still
 * infer literal `:param` types on the handler that follows this middleware
 * (a concrete `Context<AppContext>` parameter would otherwise widen the
 * whole route's path type and turn `c.req.param('id')` into `string | undefined`).
 */
export async function requireAdmin<P extends string = string>(
  c: Context<AppContext, P>,
  next: Next,
): Promise<Response | void> {
  const user = c.get('user');
  if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return next();
}

/**
 * Baseline security headers for every Worker-generated response.
 *
 * `script-src` intentionally omits `'unsafe-inline'` — a handful of
 * server-rendered pages (`setup/manifest.ts`) embed a small inline
 * `<script>`, so this middleware mints a fresh per-request nonce *before*
 * the route runs, exposes it via `c.get('cspNonce')`, and allow-lists only
 * that one-time value. A page with no inline script simply never reads the
 * nonce and nothing is weakened; a page that does read it can only run the
 * exact `<script nonce="...">` this response generated, not an injected one.
 */
export async function securityHeaders(c: Context<AppContext>, next: Next): Promise<void> {
  const nonce = crypto.randomUUID();
  c.set('cspNonce', nonce);
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'no-referrer');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.res.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; img-src 'self' https://avatars.githubusercontent.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'; frame-ancestors 'none'`,
  );
}
