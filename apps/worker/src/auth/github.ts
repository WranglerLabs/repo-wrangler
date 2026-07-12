import { Hono } from 'hono';
import { recordAuditEvent } from '@repo-wrangler/persistence-d1';
import { isDemoMode } from '../bindings';
import type { AppContext } from '../middleware/auth';
import {
  clearSessionCookie,
  createSessionCookie,
  createStateToken,
  readSession,
  verifyStateToken,
} from '../lib/session';

/**
 * Dashboard sign-in via the GitHub App's user authorization (OAuth) flow.
 * The user access token is used once to identify the user and is then
 * discarded — it is never stored or sent to the browser.
 */
export const authRoutes = new Hono<AppContext>();

const STATE_COOKIE = 'rw_oauth_state';

function allowlistedRole(
  login: string,
  allowedUsers: string | undefined,
): 'owner' | 'admin' | 'viewer' | null {
  const users = (allowedUsers ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (users.length === 0) return null;
  const index = users.findIndex((u) => u.toLowerCase() === login.toLowerCase());
  if (index === -1) return null;
  // Convention for the single-tenant MVP: first allowlisted user is the owner.
  return index === 0 ? 'owner' : 'admin';
}

authRoutes.get('/github/login', async (c) => {
  if (isDemoMode(c.env)) return c.redirect('/');
  const clientId = c.env.GITHUB_CLIENT_ID;
  const secret = c.env.SESSION_SECRET;
  if (!clientId || !secret) {
    return c.json({ error: 'GitHub login is not configured.' }, 500);
  }
  const state = await createStateToken(secret);
  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/auth/github/callback`;
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  c.header(
    'Set-Cookie',
    `${STATE_COOKIE}=${state}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
  );
  return c.redirect(authorizeUrl.toString());
});

authRoutes.get('/github/callback', async (c) => {
  const secret = c.env.SESSION_SECRET;
  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  if (!secret || !clientId || !clientSecret) {
    return c.json({ error: 'GitHub login is not configured.' }, 500);
  }

  const state = c.req.query('state');
  const code = c.req.query('code');
  const cookieState = c.req
    .header('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!state || !code || state !== cookieState || !(await verifyStateToken(secret, state))) {
    return c.json({ error: 'Invalid OAuth state.' }, 400);
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    return c.json({ error: 'Token exchange failed.' }, 401);
  }

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${tokenData.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'repo-wrangler',
    },
  });
  const userData = (await userResponse.json()) as { login?: string };
  if (!userData.login) {
    return c.json({ error: 'Could not identify GitHub user.' }, 401);
  }

  const role = allowlistedRole(userData.login, c.env.ALLOWED_GITHUB_USERS);
  if (!role) {
    await recordAuditEvent(c.env.DB, userData.login, 'login.denied', 'Not on allowlist');
    return c.json({ error: 'This GitHub account is not authorized for this instance.' }, 403);
  }

  await recordAuditEvent(c.env.DB, userData.login, 'login.success', `role=${role}`);
  const cookie = await createSessionCookie(secret, { login: userData.login, role }, true);
  c.header('Set-Cookie', cookie, { append: true });
  c.header('Set-Cookie', `${STATE_COOKIE}=; Path=/auth; HttpOnly; Max-Age=0`, { append: true });
  return c.redirect('/');
});

authRoutes.post('/logout', async (c) => {
  const secret = c.env.SESSION_SECRET;
  if (secret) {
    const user = await readSession(secret, c.req.header('cookie'));
    if (user) await recordAuditEvent(c.env.DB, user.login, 'logout');
  }
  c.header('Set-Cookie', clearSessionCookie());
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  if (isDemoMode(c.env)) {
    return c.json({ login: 'demo', role: 'viewer', demo: true });
  }
  const secret = c.env.SESSION_SECRET;
  if (!secret) return c.json({ error: 'unconfigured' }, 500);
  const user = await readSession(secret, c.req.header('cookie'));
  if (!user) return c.json({ error: 'unauthenticated' }, 401);
  return c.json(user);
});
