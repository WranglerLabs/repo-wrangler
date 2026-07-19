/**
 * GitHub App Manifest flow (Phase B, `setup/manifest.ts`): the pre-filled
 * manifest page suggests a collision-proof App name, and the callback page
 * auto-exchanges the setup code so the operator never has to copy/paste it,
 * falling back to a copy button + mobile instructions when that call fails.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { setupRoutes } from '../src/setup/manifest';
import type { Env } from '../src/bindings';
import { securityHeaders, type AppContext } from '../src/middleware/auth';

// Mounted exactly like `index.ts` — the `securityHeaders` middleware (which
// sets the CSP header these pages' inline <script> tags must satisfy) has to
// be present for these tests to mean anything. A bare `setupRoutes` mount
// would pass even if the CSP silently killed the inline script in the
// browser (that's exactly how the auto-exchange-callback regression slipped
// through: the CSP header wasn't part of the request under test).
function testApp() {
  const app = new Hono<AppContext>();
  app.use('*', securityHeaders);
  app.route('/setup', setupRoutes);
  return app;
}

function env(overrides: Partial<Env> = {}): Env {
  return { DB: {}, ASSETS: {}, ...overrides } as unknown as Env;
}

function manifestFromHtml(html: string): Record<string, unknown> {
  const encoded = html.match(/name="manifest" value="([^"]+)"/)?.[1];
  expect(encoded).toBeTruthy();
  return JSON.parse(encoded!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as Record<string, unknown>;
}

describe('GET /setup/github-app', () => {
  it('suggests a unique, non-reserved App name', async () => {
    const res = await testApp().request('/setup/github-app', {}, env());
    expect(res.status).toBe(200);
    const html = await res.text();
    const match = html.match(/&quot;name&quot;:&quot;(repo-wrangler-[a-z0-9]{4,6})&quot;/);
    expect(match).not.toBeNull();
    expect(match?.[1]).not.toBe('RepoWrangler');
  });

  it('suggests a different name on each request', async () => {
    const app = testApp();
    const first = await (await app.request('/setup/github-app', {}, env())).text();
    const second = await (await app.request('/setup/github-app', {}, env())).text();
    const nameOf = (html: string) => html.match(/&quot;name&quot;:&quot;([^&]+)&quot;/)?.[1];
    expect(nameOf(first)).not.toBe(nameOf(second));
  });

  it('omits GitHub webhooks for loopback deployments GitHub cannot call', async () => {
    const html = await (await testApp().request('/setup/github-app', {}, env())).text();
    const manifest = manifestFromHtml(html);
    expect(manifest.redirect_url).toBe('http://localhost/setup/github-app/callback');
    expect(manifest.callback_urls).toEqual(['http://localhost/auth/github/callback']);
    expect(manifest).not.toHaveProperty('hook_attributes');
    expect(manifest).not.toHaveProperty('default_events');
    expect(html).toContain('local and private-network deployments use scheduled and manual synchronization');
  });

  it('includes GitHub webhooks only for a configured public HTTPS origin', async () => {
    const html = await (
      await testApp().request('/setup/github-app', {}, env({ PUBLIC_BASE_URL: 'https://repos.example.com' }))
    ).text();
    const manifest = manifestFromHtml(html);
    expect(manifest.hook_attributes).toEqual({
      url: 'https://repos.example.com/webhooks/github',
      active: true,
    });
    expect(manifest.default_events).toBeInstanceOf(Array);
  });
});

describe('GET /setup/github-app/callback', () => {
  it('shows a restart prompt when no code is present', async () => {
    const res = await testApp().request('/setup/github-app/callback', {}, env());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('No code found in the redirect');
    expect(html).not.toContain('/api/v1/connections/github/exchange');
  });

  it('auto-POSTs the code to the exchange endpoint and offers a copy-button fallback', async () => {
    const res = await testApp().request('/setup/github-app/callback?code=one-hour-code-123', {}, env());
    expect(res.status).toBe(200);
    const html = await res.text();
    // Auto-exchange, same-origin so the wizard session cookie rides along.
    expect(html).toContain("fetch('/api/v1/connections/github/exchange'");
    expect(html).toContain('credentials: \'same-origin\'');
    expect(html).toContain("sessionStorage.getItem('rw-setup-token')");
    expect(html).toContain("headers['X-Setup-Token'] = setupToken");
    expect(html).toContain("window.location.href = '/onboarding'");
    // Fallback UI for when the exchange fails (401 / network error).
    expect(html).toContain('id="copyBtn"');
    expect(html).toContain('navigator.clipboard');
    expect(html).toContain('I have a setup code');
    // The code itself is sanitized and embedded for both display and the fetch body.
    expect(html).toContain('one-hour-code-123');
  });

  it('strips unsafe characters out of the code before embedding it', async () => {
    const res = await testApp().request(
      '/setup/github-app/callback?code=' + encodeURIComponent('abc<script>alert(1)</script>'),
      {},
      env(),
    );
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('abcscriptalert1script');
  });

  it('has a watchdog that forces the fallback to render even if the exchange call hangs', async () => {
    const res = await testApp().request('/setup/github-app/callback?code=one-hour-code-123', {}, env());
    const html = await res.text();
    expect(html).toContain('setTimeout(function () {');
    expect(html).toContain('showFallback(\'Automatic setup is taking longer than expected');
    expect(html).toContain('8000');
  });
});

// Regression coverage for the "callback page just sits there" bug: the CSP
// header's `script-src` has no blanket `'unsafe-inline'`, so an inline
// <script> only runs if it carries the exact nonce the same response's CSP
// header allow-listed. If these two ever drift apart again — e.g. someone
// reverts to a static `<script>` without threading `c.get('cspNonce')`
// through — the browser silently no-ops the script exactly like it did
// before this fix, and these tests catch it without needing a real browser.
describe('CSP / inline-script compatibility', () => {
  function nonceFromCsp(res: Response): string {
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const match = csp.match(/script-src[^;]*'nonce-([^']+)'/);
    expect(match, `no script-src nonce in CSP header: ${csp}`).not.toBeNull();
    return match![1];
  }

  it('the callback page script nonce matches the CSP header nonce', async () => {
    const res = await testApp().request('/setup/github-app/callback?code=one-hour-code-123', {}, env());
    const nonce = nonceFromCsp(res);
    const html = await res.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
  });

  it('the create-app page script nonce matches the CSP header nonce', async () => {
    const res = await testApp().request('/setup/github-app', {}, env());
    const nonce = nonceFromCsp(res);
    const html = await res.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
  });

  it('mints a fresh nonce per request (no reused/predictable value)', async () => {
    const app = testApp();
    const first = await app.request('/setup/github-app/callback?code=abc', {}, env());
    const second = await app.request('/setup/github-app/callback?code=abc', {}, env());
    expect(nonceFromCsp(first)).not.toBe(nonceFromCsp(second));
  });
});
