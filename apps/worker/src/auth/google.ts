import { Hono } from 'hono';
import { isDemoMode, type Env } from '../bindings';
import type { AppContext } from '../middleware/auth';
import { createStateToken, verifyStateToken } from '../lib/session';
import {
  clearTransientCookie,
  completeSignIn,
  decodeJwtPayload,
  readCookie,
  transientCookie,
  type AuthProvider,
} from './types';

/**
 * Dashboard sign-in via Google using the OpenID Connect authorization-code flow
 * (ADR-019, PN-5). The `id_token` comes back over a TLS back-channel exchange
 * authenticated with the client secret, so it is trusted without re-validating
 * its signature; issuer, audience, expiry, and the login nonce are still checked.
 * The verified email is the identity matched against the allowlist.
 */
export const googleAuthRoutes = new Hono<AppContext>();

const STATE_COOKIE = 'rw_google_state';
const NONCE_COOKIE = 'rw_google_nonce';

export function isGoogleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

googleAuthRoutes.get('/google/login', async (c) => {
  if (isDemoMode(c.env)) return c.redirect('/');
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const secret = c.env.SESSION_SECRET;
  if (!clientId || !secret) {
    return c.json({ error: 'Google login is not configured.' }, 500);
  }
  const state = await createStateToken(secret);
  const nonce = crypto.randomUUID();
  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/auth/google/callback`;
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'openid email profile');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);
  c.header('Set-Cookie', transientCookie(STATE_COOKIE, state), { append: true });
  c.header('Set-Cookie', transientCookie(NONCE_COOKIE, nonce), { append: true });
  return c.redirect(authorizeUrl.toString());
});

googleAuthRoutes.get('/google/callback', async (c) => {
  const secret = c.env.SESSION_SECRET;
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  if (!secret || !clientId || !clientSecret) {
    return c.json({ error: 'Google login is not configured.' }, 500);
  }

  const state = c.req.query('state');
  const code = c.req.query('code');
  const cookieHeader = c.req.header('cookie');
  const stateCookie = readCookie(cookieHeader, STATE_COOKIE);
  const nonceCookie = readCookie(cookieHeader, NONCE_COOKIE);
  if (!state || !code || state !== stateCookie || !(await verifyStateToken(secret, state))) {
    return c.json({ error: 'Invalid OAuth state.' }, 400);
  }

  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/auth/google/callback`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
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
  const tokenData = (await tokenResponse.json()) as { id_token?: string };
  const claims = tokenData.id_token ? decodeJwtPayload(tokenData.id_token) : null;
  if (!claims) {
    return c.json({ error: 'No identity token returned.' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const iss = claims.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
    return c.json({ error: 'Untrusted token issuer.' }, 401);
  }
  if (claims.aud !== clientId) {
    return c.json({ error: 'Token audience mismatch.' }, 401);
  }
  if (typeof claims.exp !== 'number' || claims.exp < now) {
    return c.json({ error: 'Token expired.' }, 401);
  }
  if (!nonceCookie || claims.nonce !== nonceCookie) {
    return c.json({ error: 'Nonce mismatch.' }, 401);
  }
  if (claims.email_verified === false) {
    return c.json({ error: 'Google account email is not verified.' }, 401);
  }
  const identity = typeof claims.email === 'string' ? claims.email : '';
  if (!identity) {
    return c.json({ error: 'Could not identify the signed-in user.' }, 401);
  }

  c.header('Set-Cookie', clearTransientCookie(STATE_COOKIE), { append: true });
  c.header('Set-Cookie', clearTransientCookie(NONCE_COOKIE), { append: true });
  return completeSignIn(c, {
    provider: 'google',
    identity,
    allowedUsers: c.env.GOOGLE_ALLOWED_USERS,
  });
});

export const googleProvider: AuthProvider = {
  id: 'google',
  label: 'Google',
  isConfigured: isGoogleConfigured,
  routes: googleAuthRoutes,
};
