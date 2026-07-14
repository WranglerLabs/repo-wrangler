import type { Context, Next } from 'hono';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { isDemoMode, type Env } from '../bindings';
import { readSession } from '../lib/session';

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
    c.set('user', { login: 'demo', role: 'viewer', demo: true });
    return next();
  }
  const secret = c.env.SESSION_SECRET;
  if (!secret) {
    return c.json({ error: 'SESSION_SECRET is not configured.' }, 500);
  }
  const user = await readSession(secret, c.req.header('cookie'));
  if (!user) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  c.set('user', user);
  return next();
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
