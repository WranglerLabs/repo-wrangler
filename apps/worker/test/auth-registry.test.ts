import { describe, expect, it } from 'vitest';
import type { Env } from '../src/bindings';
import { authConfig, enabledProviders } from '../src/auth/registry';

/** A minimal Env; only the auth-relevant fields matter for these tests. */
function env(overrides: Partial<Env>): Env {
  return { DB: {}, ASSETS: {}, ...overrides } as unknown as Env;
}

describe('auth registry — provider selection', () => {
  it('falls back to GitHub when AUTH_MODE/AUTH_PROVIDERS are unset and GitHub is configured', () => {
    const providers = enabledProviders(
      env({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' }),
    );
    expect(providers.map((p) => p.id)).toEqual(['github']);
  });

  it('honours legacy AUTH_MODE=entra', () => {
    const providers = enabledProviders(
      env({
        AUTH_MODE: 'entra',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        ENTRA_CLIENT_SECRET: 's',
      }),
    );
    expect(providers.map((p) => p.id)).toEqual(['entra']);
  });

  it('enables multiple providers in the order AUTH_PROVIDERS lists them', () => {
    const providers = enabledProviders(
      env({
        AUTH_PROVIDERS: 'entra,github',
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        ENTRA_CLIENT_SECRET: 's',
      }),
    );
    expect(providers.map((p) => p.id)).toEqual(['entra', 'github']);
  });

  it('drops an enabled-but-unconfigured provider', () => {
    const providers = enabledProviders(
      env({ AUTH_PROVIDERS: 'github,google', GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' }),
    );
    // google has no client id/secret, so it is filtered out.
    expect(providers.map((p) => p.id)).toEqual(['github']);
  });

  it('never enables local-dev via the AUTH_MODE fallback', () => {
    const providers = enabledProviders(env({ LOCAL_DEV_USERS: 'dev' }));
    expect(providers.map((p) => p.id)).not.toContain('local');
  });

  it('enables local-dev only when explicitly listed and allowlisted', () => {
    const providers = enabledProviders(
      env({ AUTH_PROVIDERS: 'local', LOCAL_DEV_USERS: 'dev,other' }),
    );
    expect(providers.map((p) => p.id)).toEqual(['local']);
  });

  it('exposes GitLab and Google when configured', () => {
    const providers = enabledProviders(
      env({
        AUTH_PROVIDERS: 'gitlab,google',
        GITLAB_CLIENT_ID: 'g',
        GITLAB_CLIENT_SECRET: 'gs',
        GOOGLE_CLIENT_ID: 'go',
        GOOGLE_CLIENT_SECRET: 'gos',
      }),
    );
    expect(providers.map((p) => p.id)).toEqual(['gitlab', 'google']);
  });
});

describe('authConfig — SPA sign-in payload', () => {
  it('returns one login button per enabled provider with its URL', () => {
    const cfg = authConfig(
      env({
        AUTH_PROVIDERS: 'github,entra',
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        ENTRA_CLIENT_SECRET: 's',
        DEMO_MODE: 'true',
      }),
    );
    expect(cfg.demo).toBe(true);
    expect(cfg.providers).toEqual([
      { id: 'github', label: 'GitHub', loginUrl: '/auth/github/login' },
      { id: 'entra', label: 'Microsoft', loginUrl: '/auth/entra/login' },
    ]);
  });
});
