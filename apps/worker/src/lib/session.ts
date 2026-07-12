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
  user: SessionUserDto,
  secure: boolean,
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${encodeURIComponent(user.login)}.${user.role}.${expires}`;
  const signature = await hmac(secret, payload);
  const value = `${payload}.${signature}`;
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
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
  if (parts.length !== 4) return null;
  const [loginEncoded, role, expiresText, signature] = parts;
  if (!loginEncoded || !role || !expiresText || !signature) return null;
  const payload = `${loginEncoded}.${role}.${expiresText}`;
  const expected = await hmac(secret, payload);
  if (!timingSafeEqualString(signature, expected)) return null;
  const expires = Number(expiresText);
  if (Number.isNaN(expires) || expires * 1000 < Date.now()) return null;
  if (role !== 'owner' && role !== 'admin' && role !== 'viewer') return null;
  return { login: decodeURIComponent(loginEncoded), role };
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
