/**
 * The Node host builds the same Cloudflare-shaped `Env` the shared Hono app
 * expects (design Portability section, ADR-013). Every secret slot the
 * worker's `Env` declares (`apps/worker/src/bindings.ts`) must round-trip
 * through `loadSecrets`/`buildEnv` here — a slot missing from this file is a
 * secret the wizard silently can't see, even when the host process has it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEnv, loadSecrets, SECRET_NAMES } from '../src/env';

const SECRET_ENV_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'SESSION_SECRET',
  'GITLAB_TOKEN',
  'GITLAB_WEBHOOK_SECRET',
  'GITLAB_CLIENT_ID',
  'GITLAB_CLIENT_SECRET',
  'ENTRA_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'CRON_TRIGGER_TOKEN',
  'SECRET_ENCRYPTION_KEY',
] as const;

describe('SECRET_NAMES', () => {
  it('resolves SECRET_ENCRYPTION_KEY through the SecretProvider seam like SESSION_SECRET', () => {
    expect(SECRET_NAMES).toContain('SECRET_ENCRYPTION_KEY');
  });
});

describe('loadSecrets + buildEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SECRET_SOURCE;
    for (const key of SECRET_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes every declared secret slot through to the built Env, including SECRET_ENCRYPTION_KEY', async () => {
    for (const key of SECRET_ENV_KEYS) {
      process.env[key] = `${key.toLowerCase()}-value`;
    }

    const { secrets } = await loadSecrets();
    const env = buildEnv({} as D1Database, {} as Fetcher, secrets);

    for (const key of SECRET_ENV_KEYS) {
      expect(env[key]).toBe(`${key.toLowerCase()}-value`);
    }
  });

  it('leaves SECRET_ENCRYPTION_KEY undefined when the host has no value for it', async () => {
    const { secrets } = await loadSecrets();
    const env = buildEnv({} as D1Database, {} as Fetcher, secrets);
    expect(env.SECRET_ENCRYPTION_KEY).toBeUndefined();
  });
});
