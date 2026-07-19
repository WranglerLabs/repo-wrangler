import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..', '..');
const scratch = await mkdtemp(join(tmpdir(), 'repo-wrangler-smoke-'));
const port = 18080 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
let output = '';
const execFileAsync = promisify(execFile);

const server = spawn(
  process.execPath,
  ['--experimental-sqlite', '--import', 'tsx', 'apps/server/src/index.ts'],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_PATH: join(scratch, 'repo-wrangler.db'),
      DEMO_MODE: 'false',
      AUTH_PROVIDERS: 'github',
      ENABLE_SCHEDULER: 'false',
      SESSION_SECRET: 'smoke-session-secret-not-for-production',
      SECRET_ENCRYPTION_KEY: 'smoke-encryption-key-not-for-production',
      PUBLIC_BASE_URL: origin,
      APP_VERSION: 'smoke-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });

async function request(path, init) {
  return fetch(`${origin}${path}`, { redirect: 'manual', ...init });
}

async function waitUntilReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited early (${server.exitCode})\n${output}`);
    try {
      const response = await request('/health/ready');
      if (response.ok) return;
    } catch {
      // The TCP listener is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`server did not become ready\n${output}`);
}

function manifestFromHtml(html) {
  const encoded = /name="manifest" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(encoded, 'GitHub manifest form is missing');
  return JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
}

try {
  await waitUntilReady();

  const live = await (await request('/health/live')).json();
  assert.deepEqual(live, { ok: true, version: 'smoke-test' });

  const spa = await request('/onboarding');
  assert.equal(spa.status, 200);
  const spaHtml = await spa.text();
  assert.match(spaHtml, /<div id="root">/);
  const scriptPath = /<script[^>]+src="([^"]+\.js)"/.exec(spaHtml)?.[1];
  assert.ok(scriptPath, 'built SPA JavaScript reference is missing');
  const script = await request(scriptPath);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);

  const initialAuth = await (await request('/auth/config')).json();
  assert.equal(initialAuth.setupMode, true);
  assert.deepEqual(initialAuth.providers, []);

  const initialIdentity = await (await request('/api/v1/identity/configuration')).json();
  assert.equal(initialIdentity.selectedProvider, null);

  const selectGitHub = await request('/api/v1/identity/configure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'github', allowedUsers: 'smoke-owner' }),
  });
  assert.equal(selectGitHub.status, 200);

  const setupPage = await request('/setup/github-app');
  assert.equal(setupPage.status, 200);
  const localManifest = manifestFromHtml(await setupPage.text());
  assert.equal(localManifest.redirect_url, `${origin}/setup/github-app/callback`);
  assert.equal(localManifest.hook_attributes, undefined);
  assert.equal(localManifest.default_events, undefined);

  const selectEntra = await request('/api/v1/identity/configure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'entra',
      tenantId: 'smoke-tenant',
      clientId: 'smoke-client',
      clientSecret: 'smoke-client-secret',
      allowedUsers: 'admin@example.test',
    }),
  });
  assert.equal(selectEntra.status, 200);

  const configuredAuth = await (await request('/auth/config')).json();
  assert.equal(configuredAuth.setupMode, true);
  assert.deepEqual(configuredAuth.providers, [
    { id: 'entra', label: 'Microsoft', loginUrl: '/auth/entra/login' },
  ]);
  assert.equal((await request('/api/v1/onboarding/status')).status, 200);

  const entraLogin = await request('/auth/entra/login');
  assert.equal(entraLogin.status, 302);
  const location = new URL(entraLogin.headers.get('location'));
  assert.equal(location.origin + location.pathname,
    'https://login.microsoftonline.com/smoke-tenant/oauth2/v2.0/authorize');
  assert.equal(location.searchParams.get('client_id'), 'smoke-client');
  assert.equal(location.searchParams.get('redirect_uri'), `${origin}/auth/entra/callback`);

  console.log('Built Node server first-run smoke test passed.');
} finally {
  if (server.exitCode === null) {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill.exe', ['/pid', String(server.pid), '/t', '/f']).catch(() => undefined);
    } else {
      server.kill('SIGTERM');
    }
  }
  await Promise.race([
    new Promise((resolveExit) => server.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 12_000)),
  ]);
  if (server.exitCode === null && process.platform !== 'win32') server.kill('SIGKILL');
  await rm(scratch, { recursive: true, force: true });
}
