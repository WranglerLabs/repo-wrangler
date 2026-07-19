import assert from 'node:assert/strict';

const origin = process.argv[2];
const expectedVersion = process.argv[3];
if (!origin || !expectedVersion) throw new Error('usage: smoke-container.mjs <origin> <expected-version>');

async function request(path, init) {
  return fetch(`${origin}${path}`, { redirect: 'manual', ...init });
}

const deadline = Date.now() + 45_000;
while (true) {
  try {
    if ((await request('/health/ready')).ok) break;
  } catch {
    // Container listener is not ready yet.
  }
  if (Date.now() >= deadline) throw new Error('container did not become ready');
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
}

const live = await (await request('/health/live')).json();
assert.deepEqual(live, { ok: true, version: expectedVersion });

const spaHtml = await (await request('/onboarding')).text();
const scriptPath = /<script[^>]+src="([^"]+\.js)"/.exec(spaHtml)?.[1];
assert.ok(scriptPath, 'built SPA JavaScript reference is missing');
assert.equal((await request(scriptPath)).status, 200);

const auth = await (await request('/auth/config')).json();
assert.equal(auth.setupMode, true);
assert.deepEqual(auth.providers, []);

const manifestHtml = await (await request('/setup/github-app')).text();
const encoded = /name="manifest" value="([^"]+)"/.exec(manifestHtml)?.[1];
assert.ok(encoded, 'GitHub manifest form is missing');
const manifest = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
assert.equal(manifest.hook_attributes, undefined);
assert.equal(manifest.default_events, undefined);

const identity = await request('/api/v1/identity/configure', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ provider: 'github', allowedUsers: 'container-smoke-owner' }),
});
assert.equal(identity.status, 200);
assert.equal((await (await request('/auth/config')).json()).setupMode, true);

console.log('Built container first-run smoke test passed.');
