import type { Context, Next } from 'hono';
import type { SessionUserDto } from '@repo-wrangler/contracts';
import { isDemoMode, type Env } from '../bindings';
import { readSession } from '../lib/session';

export type AppContext = {
  Bindings: Env;
  Variables: { user: SessionUserDto };
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

/** Require the admin or owner role (mutating admin endpoints). */
export async function requireAdmin(c: Context<AppContext>, next: Next): Promise<Response | void> {
  const user = c.get('user');
  if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return next();
}

/** Baseline security headers for every Worker-generated response. */
export async function securityHeaders(c: Context<AppContext>, next: Next): Promise<void> {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'no-referrer');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https://avatars.githubusercontent.com data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  );
}
