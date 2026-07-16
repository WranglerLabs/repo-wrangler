import type { SessionUserDto } from '@repo-wrangler/contracts';

/**
 * Stateless HMAC-signed session cookie. The browser never receives provider
 * token material — only `login.role.expiry.signature`.
 */

const COOKIE_NAME = 'rw_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function hmac(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64UrlEncode(new Uint8Array(mac));
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(
  secret: string,
  user: SessionUserDto & { provider: NonNullable<SessionUserDto['provider']> },
  secure: boolean,
  sameSite: 'Lax' | 'None' = 'Lax',
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  // encodeURIComponent leaves `.` unescaped, but `.` is this cookie's field
  // separator — encode it too, or email-style logins (Entra/Google/GitLab)
  // produce a 5+-part value that readSession rejects, looping sign-in forever.
  const loginEncoded = encodeURIComponent(user.login).replace(/\./g, '%2E');
  const payload = `${loginEncoded}.${user.role}.${user.provider}.${expires}`;
  const signature = await hmac(secret, payload);
  const value = `${payload}.${signature}`;
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(sameSite: 'Lax' | 'None' = 'Lax'): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0; Secure`;
}

export async function readSession(
  secret: string,
  cookieHeader: string | undefined,
): Promise<SessionUserDto | null> {
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  const value = cookie.slice(COOKIE_NAME.length + 1);
  const parts = value.split('.');
  // Four-field cookies predate provider binding. They are deliberately invalid:
  // without the issuer we cannot revoke a session when its provider is disabled.
  if (parts.length !== 5) return null;
  const [loginEncoded, role, provider, expiresText, signature] = parts;
  if (!loginEncoded || !role || !provider || !expiresText || !signature) return null;
  const payload = `${loginEncoded}.${role}.${provider}.${expiresText}`;
  const expected = await hmac(secret, payload);
  if (!timingSafeEqualString(signature, expected)) return null;
  const expires = Number(expiresText);
  if (Number.isNaN(expires) || expires * 1000 < Date.now()) return null;
  if (role !== 'owner' && role !== 'admin' && role !== 'viewer') return null;
  if (!['github', 'gitlab', 'entra', 'google', 'local'].includes(provider)) return null;
  return {
    login: decodeURIComponent(loginEncoded),
    role,
    provider: provider as NonNullable<SessionUserDto['provider']>,
  };
}

/** Short-lived signed value for the OAuth state parameter. */
export async function createStateToken(secret: string): Promise<string> {
  const nonce = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + 10 * 60;
  const payload = `${nonce}.${expires}`;
  return `${payload}.${await hmac(secret, `state:${payload}`)}`;
}

export async function verifyStateToken(secret: string, token: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [nonce, expiresText, signature] = parts;
  if (!nonce || !expiresText || !signature) return false;
  const expected = await hmac(secret, `state:${nonce}.${expiresText}`);
  if (!timingSafeEqualString(signature, expected)) return false;
  return Number(expiresText) * 1000 >= Date.now();
}
