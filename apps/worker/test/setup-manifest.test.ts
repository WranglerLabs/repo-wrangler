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
import type { AppContext } from '../src/middleware/auth';

function testApp() {
  const app = new Hono<AppContext>();
  app.route('/setup', setupRoutes);
  return app;
}

function env(overrides: Partial<Env> = {}): Env {
  return { DB: {}, ASSETS: {}, ...overrides } as unknown as Env;
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
});
