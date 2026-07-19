import { describe, expect, it } from 'vitest';
import { createGitHubAppManifest, supportsEntraWebRedirect, supportsGitHubWebhooks } from '@repo-wrangler/contracts';

describe('GitHub App manifest onboarding', () => {
  it('keeps every callback on the deployment origin', () => {
    const manifest = createGitHubAppManifest('http://127.0.0.1:8080', 'abc123');
    expect(manifest.name).toBe('repo-wrangler-abc123');
    expect(manifest.hook_attributes).toBeUndefined();
    expect(manifest.default_events).toBeUndefined();
    expect(manifest.redirect_url).toBe('http://127.0.0.1:8080/setup/github-app/callback');
    expect(manifest.callback_urls).toEqual(['http://127.0.0.1:8080/auth/github/callback']);
  });

  it('enables webhooks only for public HTTPS deployments', () => {
    expect(supportsGitHubWebhooks('https://repo.example.com')).toBe(true);
    expect(supportsGitHubWebhooks('http://repo.example.com')).toBe(false);
    expect(supportsGitHubWebhooks('https://192.168.1.165')).toBe(false);
    const manifest = createGitHubAppManifest('https://repo.example.com', 'def456');
    expect(manifest.hook_attributes?.url).toBe('https://repo.example.com/webhooks/github');
    expect(manifest.default_events).toContain('push');
  });

  it.each([
    'http://127.0.0.1:8080',
    'https://localhost:8080',
    'https://repo-wrangler',
    'https://repo.local',
    'https://10.0.0.4',
    'https://172.31.1.4',
    'https://192.168.1.165',
    'https://100.64.0.1',
    'https://[::1]:8080',
    'https://[fd00::1]',
    'ftp://repo.example.com',
    'not-an-origin',
    'https://localhost@repo.example.com',
    'https://[broken',
  ])('does not advertise a webhook for non-public origin %s', (origin) => {
    expect(supportsGitHubWebhooks(origin)).toBe(false);
    expect(createGitHubAppManifest(origin, 'private')).not.toHaveProperty('hook_attributes');
  });

  it('allows Entra web redirects only on HTTPS or explicit loopback HTTP', () => {
    expect(supportsEntraWebRedirect('https://repos.example.com')).toBe(true);
    expect(supportsEntraWebRedirect('http://localhost:8080')).toBe(true);
    expect(supportsEntraWebRedirect('http://127.0.0.1:8080')).toBe(true);
    expect(supportsEntraWebRedirect('http://[::1]:8080')).toBe(true);
    expect(supportsEntraWebRedirect('http://192.168.1.165:8080')).toBe(false);
    expect(supportsEntraWebRedirect('http://repos.example.com')).toBe(false);
  });
});
