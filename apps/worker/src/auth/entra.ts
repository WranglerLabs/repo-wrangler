import { Hono } from 'hono';
import { recordAuditEvent } from '@repo-wrangler/persistence-d1';
import { isDemoMode, isEntraConfigured } from '../bindings';
import type { AppContext } from '../middleware/auth';
import { createSessionCookie, createStateToken, verifyStateToken } from '../lib/session';

/**
 * Dashboard sign-in via Microsoft Entra ID (Azure AD) using the OpenID Connect
 * authorization-code flow. This is the `AUTH_MODE=entra` alternative to GitHub
 * user-authorization sign-in — the same signed session cookie is issued, so
 * everything downstream (session middleware, roles, `/auth/me`) is unchanged.
 *
 * The ID token is obtained over a back-channel exchange with the token endpoint,
 * authenticated with the app's client secret over TLS. Per OpenID Connect §3.1.3.7,
 * a token received this way may be trusted without re-validating its signature;
 * we still validate issuer, audience, expiry, and the login-bound nonce. No
 * Cloudflare-specific API is used — only Web Crypto and `fetch`, so this runs on
 * both the Worker and the Node host.
 */
export const entraRoutes = new Hono<AppContext>();

const STATE_COOKIE = 'rw_entra_state';
const NONCE_COOKIE = 'rw_entra_nonce';

function authority(tenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Decode a JWT payload (no signature check — see file header for why). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts.length === 3 ? parts[1] : undefined;
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function allowlistedRole(
  identity: string,
  allowed: string | undefined,
): 'owner' | 'admin' | 'viewer' | null {
  const names = (allowed ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  const index = names.findIndex((u) => u.toLowerCase() === identity.toLowerCase());
  if (index === -1) return null;
  return index === 0 ? 'owner' : 'admin';
}

/** Issuer is trusted when it matches the tenant, or the host for multi-tenant. */
function issuerTrusted(iss: unknown, tenant: string): boolean {
  if (typeof iss !== 'string') return false;
  if (iss === `https://login.microsoftonline.com/${tenant}/v2.0`) return true;
  // common/organizations/consumers resolve to a concrete tenant GUID at runtime.
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

  c.header(
    'Set-Cookie',
    `${STATE_COOKIE}=${state}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
    { append: true },
  );
  c.header(
    'Set-Cookie',
    `${NONCE_COOKIE}=${nonce}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
    { append: true },
  );
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

  // Validate the token binding: issuer, audience, expiry, and login nonce.
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

  const role = allowlistedRole(identity, c.env.ENTRA_ALLOWED_USERS);
  if (!role) {
    await recordAuditEvent(c.env.DB, identity, 'login.denied', 'Not on Entra allowlist');
    return c.json({ error: 'This account is not authorized for this instance.' }, 403);
  }

  await recordAuditEvent(c.env.DB, identity, 'login.success', `provider=entra role=${role}`);
  const cookie = await createSessionCookie(secret, { login: identity, role }, true);
  c.header('Set-Cookie', cookie, { append: true });
  c.header('Set-Cookie', `${STATE_COOKIE}=; Path=/auth; HttpOnly; Max-Age=0`, { append: true });
  c.header('Set-Cookie', `${NONCE_COOKIE}=; Path=/auth; HttpOnly; Max-Age=0`, { append: true });
  return c.redirect('/');
});
