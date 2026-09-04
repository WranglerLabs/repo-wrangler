import type { UpgradeActor } from '@repo-wrangler/domain';

export type UpgradeProtectedAction = 'request' | 'cancel' | 'rollback';

export interface UpgradeActionBinding {
  actor: UpgradeActor;
  action: UpgradeProtectedAction;
  deploymentTarget: string;
  targetVersion: string;
  targetDigest: string;
}

export interface UpgradeActionTokenPayload {
  actorId: string;
  actorRole: 'owner' | 'admin';
  action: UpgradeProtectedAction;
  deploymentTarget: string;
  targetVersion: string;
  targetDigest: string;
  nonce: string;
  expiresAt: number;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decode(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return encode(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function createUpgradeActionToken(
  secret: string,
  binding: UpgradeActionBinding,
  now = Date.now(),
  ttlSeconds = 5 * 60,
): Promise<{ token: string; payload: UpgradeActionTokenPayload }> {
  const payload: UpgradeActionTokenPayload = {
    actorId: binding.actor.id,
    actorRole: binding.actor.role,
    action: binding.action,
    deploymentTarget: binding.deploymentTarget,
    targetVersion: binding.targetVersion,
    targetDigest: binding.targetDigest,
    nonce: crypto.randomUUID(),
    expiresAt: Math.floor(now / 1000) + ttlSeconds,
  };
  const encoded = encode(new TextEncoder().encode(JSON.stringify(payload)));
  return { token: `${encoded}.${await sign(secret, `upgrade:${encoded}`)}`, payload };
}

export async function verifyUpgradeActionToken(
  secret: string,
  token: string,
  expected: UpgradeActionBinding,
  now = Date.now(),
): Promise<UpgradeActionTokenPayload | null> {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expectedSignature = await sign(secret, `upgrade:${encoded}`);
  if (!timingSafeEqual(signature, expectedSignature)) return null;
  const bytes = decode(encoded);
  if (!bytes) return null;
  let payload: UpgradeActionTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as UpgradeActionTokenPayload;
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < Math.floor(now / 1000)) {
    return null;
  }
  if (payload.actorId !== expected.actor.id || payload.actorRole !== expected.actor.role
    || payload.action !== expected.action
    || payload.deploymentTarget !== expected.deploymentTarget
    || payload.targetVersion !== expected.targetVersion
    || payload.targetDigest !== expected.targetDigest
    || !payload.nonce) return null;
  return payload;
}

/** Upgrade mutations reject requests without an exact trusted browser origin. */
export function isAllowedUpgradeOrigin(input: {
  requestUrl: string;
  origin?: string;
  publicBaseUrl?: string;
  corsAllowedOrigins?: string[];
}): boolean {
  if (!input.origin) return false;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(input.publicBaseUrl ?? input.requestUrl).origin;
  } catch {
    return false;
  }
  return input.origin === expectedOrigin || (input.corsAllowedOrigins ?? []).includes(input.origin);
}

/** Redact common credential forms before persistence, logs, or API output. */
export function redactUpgradeDetail(detail: string, limit = 500): string {
  return detail
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(https:\/\/)(?:[^/@\s]+)@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|sig|signature|secret|key)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/\b((?:token|pat|password|secret|client_secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, limit);
}
