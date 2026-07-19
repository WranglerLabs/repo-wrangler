import { describe, expect, it } from 'vitest';
import { githubAppManifest } from '../src/routes/Onboarding';

describe('GitHub App manifest onboarding', () => {
  it('keeps every callback on the deployment origin', () => {
    const manifest = githubAppManifest('http://127.0.0.1:8080', 'abc123');
    expect(manifest.name).toBe('repo-wrangler-abc123');
    expect(manifest.hook_attributes.url).toBe('http://127.0.0.1:8080/webhooks/github');
    expect(manifest.redirect_url).toBe('http://127.0.0.1:8080/setup/github-app/callback');
    expect(manifest.callback_urls).toEqual(['http://127.0.0.1:8080/auth/github/callback']);
  });
});
