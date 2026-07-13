import { Hono } from 'hono';
import { isDemoMode, isEntraConfigured, type Env } from '../bindings';
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
 * Dashboard sign-in via Microsoft Entra ID (Azure AD) using the OpenID Connect
 * authorization-code flow — one of the sign-in providers behind the
 * `IAuthenticationProvider` seam (ADR-019), not a special "auth mode". The ID
 * token is obtained over a back-channel exchange authenticated with the app's
 * client secret over TLS; per OpenID Connect §3.1.3.7 it may be trusted without
 * re-validating its signature, and we still check issuer, audience, expiry, and
 * the login-bound nonce. Only Web Crypto and `fetch` are used, so it runs on
 * both the Worker and the Node host.
 */
export const entraRoutes = new Hono<AppContext>();

const STATE_COOKIE = 'rw_entra_state';
const NONCE_COOKIE = 'rw_entra_nonce';

function authority(tenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
}

/** Issuer is trusted when it matches the tenant, or the host for multi-tenant. */
function issuerTrusted(iss: unknown, tenant: string): boolean {
  if (typeof iss !== 'string') return false;
  if (iss === `https://login.microsoftonline.com/${tenant}/v2.0`) return true;
  const multiTenant = tenant === 'common' || tenant === 'organizations' || tenant === 'consumers';
  return multiTenant && /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/i.test(iss);
}

entraRoutes.get('/entra/login', async (c) => {
  if (isDemoMode(c.env)) return c.redirect('/');
  if (!isEntraConfigured(c.env) || !c.env.SESSION_SECRET) {
    return c.json({ error: 'Entra sign-in is not configured.' }, 500);
  }
  const tenant = c.env.ENTRA_TENANT_ID as string;
  const clientId = c.env.ENTRA_CLIENT_ID as string;
  const secret = c.env.SESSION_SECRET;
  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/auth/entra/callback`;

  const state = await createStateToken(secret);
  const nonce = crypto.randomUUID();

  const authorizeUrl = new URL(`${authority(tenant)}/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_mode', 'query');
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);

  c.header('Set-Cookie', transientCookie(STATE_COOKIE, state), { append: true });
  c.header('Set-Cookie', transientCookie(NONCE_COOKIE, nonce), { append: true });
  return c.redirect(authorizeUrl.toString());
});

entraRoutes.get('/entra/callback', async (c) => {
  if (!isEntraConfigured(c.env) || !c.env.SESSION_SECRET) {
    return c.json({ error: 'Entra sign-in is not configured.' }, 500);
  }
  const tenant = c.env.ENTRA_TENANT_ID as string;
  const clientId = c.env.ENTRA_CLIENT_ID as string;
  const clientSecret = c.env.ENTRA_CLIENT_SECRET as string;
  const secret = c.env.SESSION_SECRET;

  const state = c.req.query('state');
  const code = c.req.query('code');
  const cookieHeader = c.req.header('cookie');
  const stateCookie = readCookie(cookieHeader, STATE_COOKIE);
  const nonceCookie = readCookie(cookieHeader, NONCE_COOKIE);

  if (!state || !code || state !== stateCookie || !(await verifyStateToken(secret, state))) {
    return c.json({ error: 'Invalid sign-in state.' }, 400);
  }

  const baseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/auth/entra/callback`;
  const tokenResponse = await fetch(`${authority(tenant)}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
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
  if (!issuerTrusted(claims.iss, tenant)) {
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

  const identity =
    (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
    (typeof claims.email === 'string' && claims.email) ||
    (typeof claims.upn === 'string' && claims.upn) ||
    '';
  if (!identity) {
    return c.json({ error: 'Could not identify the signed-in user.' }, 401);
  }

  c.header('Set-Cookie', clearTransientCookie(STATE_COOKIE), { append: true });
  c.header('Set-Cookie', clearTransientCookie(NONCE_COOKIE), { append: true });
  return completeSignIn(c, {
    provider: 'entra',
    identity,
    allowedUsers: c.env.ENTRA_ALLOWED_USERS,
  });
});

export const entraProvider: AuthProvider = {
  id: 'entra',
  label: 'Microsoft',
  isConfigured: isEntraConfigured,
  routes: entraRoutes,
};
