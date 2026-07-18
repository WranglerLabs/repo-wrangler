import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('service worker application-shell safety', () => {
  it('evicts the old cache and never stores failed asset responses', async () => {
    const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

    expect(source).toContain("repo-wrangler-shell-v2");
    expect(source).toContain('response.ok');
    expect(source).toContain("response.type === 'basic'");
    expect(source).not.toMatch(/fetch\(request\)\.then\(\(response\) => \{\s*const copy/);
  });
});
