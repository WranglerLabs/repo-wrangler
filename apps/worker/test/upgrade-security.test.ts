import { describe, expect, it } from 'vitest';
import {
  createUpgradeActionToken,
  isAllowedUpgradeOrigin,
  redactUpgradeDetail,
  verifyUpgradeActionToken,
} from '../src/lib/upgrade-security';

const actor = { id: 'owner@example.test', displayName: 'Owner', role: 'owner' as const };
const binding = {
  actor,
  action: 'request' as const,
  deploymentTarget: 'production',
  targetVersion: 'v1.0.24',
  targetDigest: `sha256:${'a'.repeat(64)}`,
};

describe('upgrade request security', () => {
  it('issues a short-lived action token bound to actor, action, target, and digest', async () => {
    const issued = await createUpgradeActionToken('strong-session-secret', binding, 1_000_000, 300);
    await expect(verifyUpgradeActionToken(
      'strong-session-secret', issued.token, binding, 1_100_000,
    )).resolves.toMatchObject({
      actorId: actor.id, actorRole: 'owner', action: 'request',
      deploymentTarget: 'production', targetVersion: 'v1.0.24',
      targetDigest: binding.targetDigest,
    });
  });

  it('rejects expiry, tampering, actor changes, and target substitution', async () => {
    const issued = await createUpgradeActionToken('secret', binding, 1_000_000, 60);
    await expect(verifyUpgradeActionToken('secret', issued.token, binding, 1_061_000))
      .resolves.toBeNull();
    await expect(verifyUpgradeActionToken('wrong', issued.token, binding, 1_010_000))
      .resolves.toBeNull();
    await expect(verifyUpgradeActionToken('secret', issued.token, {
      ...binding, targetDigest: `sha256:${'b'.repeat(64)}`,
    }, 1_010_000)).resolves.toBeNull();
  });

  it('requires an exact same-origin or configured frontend origin', () => {
    expect(isAllowedUpgradeOrigin({
      requestUrl: 'https://wrangler.example.test/api/v1/admin/updates/request',
      origin: 'https://wrangler.example.test',
    })).toBe(true);
    expect(isAllowedUpgradeOrigin({
      requestUrl: 'https://api.example.test/api/v1/admin/updates/request',
      publicBaseUrl: 'https://api.example.test',
      origin: 'https://ui.example.test',
      corsAllowedOrigins: ['https://ui.example.test'],
    })).toBe(true);
    expect(isAllowedUpgradeOrigin({
      requestUrl: 'https://wrangler.example.test/api/v1/admin/updates/request',
      origin: 'https://evil.example.test',
    })).toBe(false);
    expect(isAllowedUpgradeOrigin({
      requestUrl: 'https://wrangler.example.test/api/v1/admin/updates/request',
    })).toBe(false);
  });

  it('redacts credentials from controller errors and evidence', () => {
    const raw = 'Authorization: Bearer abc123 token=secret-value https://user:pass@example.test/run?sig=xyz client_secret=hidden';
    const safe = redactUpgradeDetail(raw);
    expect(safe).not.toContain('abc123');
    expect(safe).not.toContain('secret-value');
    expect(safe).not.toContain('user:pass');
    expect(safe).not.toContain('xyz');
    expect(safe).not.toContain('hidden');
    expect(safe.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
