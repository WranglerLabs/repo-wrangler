import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('service worker application-shell safety', () => {
  it('evicts old caches and never stores or falls back to the application shell', async () => {
    const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

    expect(source).toContain("repo-wrangler-static-v3");
    expect(source).toContain('response.ok');
    expect(source).toContain("response.type === 'basic'");
    expect(source).not.toMatch(/\[['"]\/['"]/);
    expect(source).not.toContain("caches.match('/')");
    expect(source).not.toMatch(/fetch\(request\)\.then\(\(response\) => \{\s*const copy/);
  });
});
