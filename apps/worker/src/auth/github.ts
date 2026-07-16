import { Hono } from 'hono';
import { isDemoMode, type Env } from '../bindings';
import type { AppContext } from '../middleware/auth';
import { resolveGitHubOAuthClient } from '../lib/connection-secrets';
import { createStateToken, verifyStateToken } from '../lib/session';
import {
  clearTransientCookie,
  completeSignIn,
  readCookie,
  transientCookie,
  type AuthProvider,
} from './types';

/**
 * Dashboard sign-in via the GitHub App's user authorization (OAuth) flow. The
 * user access token identifies the user once and is then discarded — never
 * stored, never sent to the browser. One of the sign-in providers behind the
 * `IAuthenticationProvider` seam (ADR-019).
 */
export const authRoutes = new Hono<AppContext>();

const STATE_COOKIE = 'rw_oauth_state';

authRoutes.get('/github/login', async (c) => {
  if (isDemoMode(c.env)) return c.redirect('/');
  const secret = c.env.SESSION_SECRET;
  const client = await resolveGitHubOAuthClient(c.env, c.env.DB);
  if (!client || !secret) {
    return c.json({ error: 'GitHub login is not configured.' }, 500);
  }
  const state = await createStateToken(secret);
  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/auth/github/callback`;
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', client.clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  c.header('Set-Cookie', transientCookie(STATE_COOKIE, state));
  return c.redirect(authorizeUrl.toString());
});

authRoutes.get('/github/callback', async (c) => {
  const secret = c.env.SESSION_SECRET;
  const client = await resolveGitHubOAuthClient(c.env, c.env.DB);
  if (!secret || !client) {
    return c.json({ error: 'GitHub login is not configured.' }, 500);
  }
  const { clientId, clientSecret } = client;

  const state = c.req.query('state');
  const code = c.req.query('code');
  const cookieState = readCookie(c.req.header('cookie'), STATE_COOKIE);

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

  c.header('Set-Cookie', clearTransientCookie(STATE_COOKIE), { append: true });
  return completeSignIn(c, {
    provider: 'github',
    identity: userData.login,
    allowedUsers: c.env.ALLOWED_GITHUB_USERS,
  });
});

export const githubProvider: AuthProvider = {
  id: 'github',
  label: 'GitHub',
  isConfigured: async (env: Env) => Boolean(await resolveGitHubOAuthClient(env, env.DB)),
  routes: authRoutes,
};
