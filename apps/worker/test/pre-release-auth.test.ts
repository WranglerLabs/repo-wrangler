import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import { ensureGitHubConnection } from '@repo-wrangler/persistence-d1';
import { app } from '../src/index';
import type { Env } from '../src/bindings';
import { createSessionCookie, readSession } from '../src/lib/session';
import { writableConnectionSecretProvider } from '../src/lib/connection-secrets';
import { markSetupCompleted } from '../src/lib/setup-state';

const migrationsDir = join(__dirname, '../../../migrations');

function env(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: {},
    DEMO_MODE: 'false',
    SESSION_SECRET: 'session-secret',
    ...overrides,
  } as unknown as Env;
}

describe('pre-release authentication gate', () => {
  let db: D1Database;

  beforeEach(() => {
    const opened = openSqliteD1(':memory:');
    applyMigrations(opened.raw, migrationsDir);
    db = opened.d1 as unknown as D1Database;
  });

  it('allows only setup endpoints on a fresh real-mode install', async () => {
    const status = await app.request('/api/v1/onboarding/status', {}, env(db));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ setupMode: true, setupTokenRequired: false });

    const connections = await app.request('/api/v1/connections', {}, env(db));
    expect(connections.status).toBe(200);

    const data = await app.request('/api/v1/overview', {}, env(db));
    expect(data.status).toBe(401);
  });

  it('requires the optional setup token without exposing it', async () => {
    const protectedEnv = env(db, { SETUP_TOKEN: 'correct horse battery staple' });
    const config = await app.request('/auth/config', {}, protectedEnv);
    expect(await config.json()).toMatchObject({ setupMode: true, setupTokenRequired: true });

    const missing = await app.request('/api/v1/onboarding/status', {}, protectedEnv);
    expect(missing.status).toBe(401);
    const wrong = await app.request(
      '/api/v1/onboarding/status',
      { headers: { 'X-Setup-Token': 'wrong' } },
      protectedEnv,
    );
    expect(wrong.status).toBe(401);
    const accepted = await app.request(
      '/api/v1/onboarding/status',
      { headers: { 'X-Setup-Token': 'correct horse battery staple' } },
      protectedEnv,
    );
    expect(accepted.status).toBe(200);
    expect(JSON.stringify(await accepted.json())).not.toContain('correct horse');
  });

  it('persists the selected GitHub identity provider without prematurely closing setup', async () => {
    const identityEnv = env(db, { SECRET_ENCRYPTION_KEY: 'test-encryption-key' });
    const initial = await app.request('/api/v1/identity/configuration', {}, identityEnv);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ selectedProvider: null });

    const selected = await app.request(
      '/api/v1/identity/configure',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github', allowedUsers: 'octocat,hubot' }),
      },
      identityEnv,
    );
    expect(selected.status).toBe(200);
    expect(await selected.json()).toEqual({ ok: true, provider: 'github' });

    const stored = await db.prepare(
      `SELECT ciphertext FROM connection_secrets WHERE secret_reference = 'identity:github'`,
    ).all<{ ciphertext: string }>();
    expect(stored.results).toHaveLength(1);
    expect(JSON.stringify(stored.results)).not.toContain('octocat');

    const persisted = await app.request('/api/v1/identity/configuration', {}, identityEnv);
    expect(await persisted.json()).toEqual({ selectedProvider: 'github' });
    expect(await (await app.request('/auth/config', {}, identityEnv)).json()).toMatchObject({
      setupMode: true,
      providers: [],
    });
  });

  it('stores Entra identity encrypted, closes setup, and uses it for the login redirect', async () => {
    const configuredEnv = env(db, {
      SECRET_ENCRYPTION_KEY: 'test-encryption-key',
      PUBLIC_BASE_URL: 'https://repos.example.test',
    });
    const response = await app.request(
      '/api/v1/identity/configure',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'entra',
          tenantId: 'contoso-tenant',
          clientId: 'entra-client-id',
          clientSecret: 'plaintext-client-secret',
          allowedUsers: 'admin@example.test',
        }),
      },
      configuredEnv,
    );
    expect(response.status).toBe(200);

    const stored = await db.prepare(
      `SELECT name, ciphertext FROM connection_secrets WHERE secret_reference = 'identity:entra'`,
    ).all<{ name: string; ciphertext: string }>();
    expect(stored.results).toHaveLength(4);
    expect(JSON.stringify(stored.results)).not.toContain('plaintext-client-secret');
    expect(JSON.stringify(stored.results)).not.toContain('contoso-tenant');

    const config = await app.request('/auth/config', {}, configuredEnv);
    expect(await config.json()).toMatchObject({
      setupMode: true,
      providers: [{ id: 'entra', label: 'Microsoft', loginUrl: '/auth/entra/login' }],
    });
    expect((await app.request('/api/v1/onboarding/status', {}, configuredEnv)).status).toBe(200);

    const login = await app.request('/auth/entra/login', {}, configuredEnv);
    expect(login.status).toBe(302);
    const location = new URL(login.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(
      'https://login.microsoftonline.com/contoso-tenant/oauth2/v2.0/authorize',
    );
    expect(location.searchParams.get('client_id')).toBe('entra-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://repos.example.test/auth/entra/callback',
    );
  });

  it('rejects incomplete or unencryptable Entra setup without selecting it', async () => {
    const incomplete = await app.request(
      '/api/v1/identity/configure',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'entra', tenantId: 'tenant' }),
      },
      env(db),
    );
    expect(incomplete.status).toBe(400);

    const noEncryption = await app.request(
      '/api/v1/identity/configure',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'entra', tenantId: 'tenant', clientId: 'client', clientSecret: 'secret',
          allowedUsers: 'admin@example.test',
        }),
      },
      env(db),
    );
    expect(noEncryption.status).toBe(500);
    expect(await noEncryption.json()).toEqual({ error: 'SECRET_ENCRYPTION_KEY is not configured.' });
    expect(await (await app.request('/api/v1/identity/configuration', {}, env(db))).json()).toEqual({
      selectedProvider: null,
    });
  });

  it('rejects Entra identity on private HTTP before storing any secret', async () => {
    const response = await app.request(
      '/api/v1/identity/configure',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'entra',
          tenantId: 'tenant',
          clientId: 'client',
          clientSecret: 'secret',
          allowedUsers: 'admin@example.test',
        }),
      },
      env(db, {
        SECRET_ENCRYPTION_KEY: 'test-encryption-key',
        PUBLIC_BASE_URL: 'http://192.168.1.165:8080',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Microsoft Entra ID requires trusted HTTPS for non-loopback deployments.',
    });
    const stored = await db.prepare(
      `SELECT COUNT(*) AS count FROM connection_secrets WHERE secret_reference = 'identity:entra'`,
    ).first<{ count: number }>();
    expect(stored?.count).toBe(0);
  });

  it('refuses to select GitHub identity without an owner or encryption key', async () => {
    const noOwner = await app.request(
      '/api/v1/identity/configure',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github' }),
      },
      env(db, { SECRET_ENCRYPTION_KEY: 'test-encryption-key' }),
    );
    expect(noOwner.status).toBe(400);

    const noEncryption = await app.request(
      '/api/v1/identity/configure',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'github', allowedUsers: 'octocat' }),
      },
      env(db),
    );
    expect(noEncryption.status).toBe(500);
    expect(await (await app.request('/api/v1/identity/configuration', {}, env(db))).json()).toEqual({
      selectedProvider: null,
    });
  });

  it('blocks custom GitLab SSRF targets during tokenless setup', async () => {
    const response = await app.request(
      '/api/v1/connections/gitlab',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'http://127.0.0.1:8080', token: 'not-used' }),
      },
      env(db, { SECRET_ENCRYPTION_KEY: 'test-encryption-key' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Custom GitLab origins require SETUP_TOKEN during unauthenticated first boot.',
    });
  });

  it('keeps setup recoverable until the first successful sign-in, then closes it durably', async () => {
    const configuredEnv = env(db, {
      AUTH_PROVIDERS: 'github',
      SECRET_ENCRYPTION_KEY: 'test-encryption-key',
    });
    const connectionId = await ensureGitHubConnection(db);
    const secrets = await writableConnectionSecretProvider(configuredEnv, db, connectionId);
    await secrets.set('GITHUB_CLIENT_ID', 'client-id');
    await secrets.set('GITHUB_CLIENT_SECRET', 'client-secret');

    const status = await app.request('/api/v1/onboarding/status', {}, configuredEnv);
    expect(status.status).toBe(200);
    const config = await app.request('/auth/config', {}, configuredEnv);
    expect(await config.json()).toMatchObject({ setupMode: true, setupTokenRequired: false });

    await markSetupCompleted(db);
    expect((await app.request('/api/v1/onboarding/status', {}, configuredEnv)).status).toBe(401);
    expect(await (await app.request('/auth/config', {}, configuredEnv)).json()).toMatchObject({
      setupMode: false,
    });

    // Disabling the last real provider later must revoke its sessions without
    // reopening unauthenticated setup access against the now-populated DB.
    const disabledEnv = env(db, { AUTH_PROVIDERS: 'local', LOCAL_DEV_USERS: 'dev' });
    const reopened = await app.request('/api/v1/onboarding/status', {}, disabledEnv);
    expect(reopened.status).toBe(401);
    const disabledConfig = await app.request('/auth/config', {}, disabledEnv);
    expect(await disabledConfig.json()).toMatchObject({ setupMode: false });
  });

  it('rejects a valid cookie when its issuing provider is disabled', async () => {
    const cookie = await createSessionCookie(
      'session-secret',
      { login: 'dev', role: 'owner', provider: 'local' },
      false,
    );
    const disabled = await app.request(
      '/auth/me',
      { headers: { cookie } },
      env(db, {
        AUTH_PROVIDERS: 'github',
        GITHUB_CLIENT_ID: 'client-id',
        GITHUB_CLIENT_SECRET: 'client-secret',
      }),
    );
    expect(disabled.status).toBe(401);

    const enabled = await app.request(
      '/auth/me',
      { headers: { cookie } },
      env(db, { AUTH_PROVIDERS: 'local', LOCAL_DEV_USERS: 'dev' }),
    );
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ login: 'dev', provider: 'local' });
  });

  it('escapes operator-provided local usernames in the sign-in form', async () => {
    const response = await app.request(
      '/auth/local/login',
      {},
      env(db, {
        AUTH_PROVIDERS: 'local',
        LOCAL_DEV_USERS: 'operator,<img src=x onerror=alert(1)>',
      }),
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('issues cross-site cookies and redirects to the canonical decoupled SPA', async () => {
    const decoupledEnv = env(db, {
      AUTH_PROVIDERS: 'local',
      LOCAL_DEV_USERS: 'operator',
      CORS_ALLOWED_ORIGINS: 'https://dashboard.example.com,https://backup.example.com',
    });
    const login = await app.request('/auth/local/login', {}, decoupledEnv);
    const transient = login.headers.get('set-cookie') ?? '';
    const state = /rw_local_state=([^;]+)/.exec(transient)?.[1];
    expect(state).toBeTruthy();

    const completed = await app.request(
      '/auth/local/login',
      {
        method: 'POST',
        headers: {
          cookie: `rw_local_state=${state}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ state: state!, user: 'operator' }),
      },
      decoupledEnv,
    );
    expect(completed.status).toBe(302);
    expect(completed.headers.get('location')).toBe('https://dashboard.example.com');
    expect(completed.headers.get('set-cookie')).toContain('SameSite=None');
    expect((await app.request('/api/v1/onboarding/status', {}, decoupledEnv)).status).toBe(401);
  });

  it('rejects legacy signed cookies that do not identify a provider', async () => {
    const expires = Math.floor(Date.now() / 1000) + 60;
    const payload = `legacy.owner.${expires}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('session-secret'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
    );
    let binary = '';
    for (const byte of signature) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(await readSession('session-secret', `rw_session=${payload}.${encoded}`)).toBeNull();
  });

  it('reports the runtime APP_VERSION override', async () => {
    const config = await app.request('/auth/config', {}, env(db, { APP_VERSION: 'v9.9.9-test' }));
    expect(await config.json()).toMatchObject({ version: 'v9.9.9-test' });
    const health = await app.request('/health/live', {}, env(db, { APP_VERSION: 'v9.9.9-test' }));
    expect(await health.json()).toEqual({ ok: true, version: 'v9.9.9-test' });
  });
});
