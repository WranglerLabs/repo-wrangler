import { Hono } from 'hono';
import { isDemoMode, type Env } from '../bindings';
import type { AppContext } from '../middleware/auth';
import { createStateToken, verifyStateToken } from '../lib/session';
import {
  clearTransientCookie,
  completeSignIn,
  readCookie,
  transientCookie,
  type AuthProvider,
} from './types';

/**
 * Dashboard sign-in via GitLab's OAuth 2.0 authorization-code flow (ADR-019,
 * PN-5). Works against gitlab.com or a self-managed instance (`GITLAB_BASE_URL`).
 * The access token identifies the user once (`/api/v4/user`) and is discarded.
 */
export const gitlabAuthRoutes = new Hono<AppContext>();

const STATE_COOKIE = 'rw_gitlab_state';

function gitlabBase(env: Env): string {
  return (env.GITLAB_BASE_URL ?? 'https://gitlab.com').replace(/\/$/, '');
}

gitlabAuthRoutes.get('/gitlab/login', async (c) => {
  if (isDemoMode(c.env)) return c.redirect('/');
  const clientId = c.env.GITLAB_CLIENT_ID;
  const secret = c.env.SESSION_SECRET;
  if (!clientId || !secret) {
    return c.json({ error: 'GitLab login is not configured.' }, 500);
  }
  const state = await createStateToken(secret);
  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/auth/gitlab/callback`;
  const authorizeUrl = new URL(`${gitlabBase(c.env)}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'read_user');
  authorizeUrl.searchParams.set('state', state);
  c.header('Set-Cookie', transientCookie(STATE_COOKIE, state));
  return c.redirect(authorizeUrl.toString());
});

gitlabAuthRoutes.get('/gitlab/callback', async (c) => {
  const secret = c.env.SESSION_SECRET;
  const clientId = c.env.GITLAB_CLIENT_ID;
  const clientSecret = c.env.GITLAB_CLIENT_SECRET;
  if (!secret || !clientId || !clientSecret) {
    return c.json({ error: 'GitLab login is not configured.' }, 500);
  }

  const state = c.req.query('state');
  const code = c.req.query('code');
  const cookieState = readCookie(c.req.header('cookie'), STATE_COOKIE);
  if (!state || !code || state !== cookieState || !(await verifyStateToken(secret, state))) {
    return c.json({ error: 'Invalid OAuth state.' }, 400);
  }

  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/auth/gitlab/callback`;
  const tokenResponse = await fetch(`${gitlabBase(c.env)}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResponse.ok) {
    return c.json({ error: 'Token exchange failed.' }, 401);
  }
  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    return c.json({ error: 'Token exchange failed.' }, 401);
  }

  const userResponse = await fetch(`${gitlabBase(c.env)}/api/v4/user`, {
    headers: { authorization: `Bearer ${tokenData.access_token}`, accept: 'application/json' },
  });
  const userData = (await userResponse.json()) as { username?: string };
  if (!userData.username) {
    return c.json({ error: 'Could not identify GitLab user.' }, 401);
  }

  c.header('Set-Cookie', clearTransientCookie(STATE_COOKIE), { append: true });
  return completeSignIn(c, {
    provider: 'gitlab',
    identity: userData.username,
    allowedUsers: c.env.GITLAB_ALLOWED_USERS,
  });
});

export const gitlabProvider: AuthProvider = {
  id: 'gitlab',
  label: 'GitLab',
  isConfigured: (env: Env) => Boolean(env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET),
  routes: gitlabAuthRoutes,
};
