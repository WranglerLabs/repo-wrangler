import { describe, expect, it, vi } from 'vitest';
import { KeyVaultSecretProvider, type KeyVaultDeps } from '../src/keyvault';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('KeyVaultSecretProvider', () => {
  it('gets a token from the Container Apps identity endpoint, then reads the secret', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('identity-endpoint')) {
        return jsonResponse({ access_token: 'tok-123', expires_on: '9999999999' });
      }
      return jsonResponse({ value: 'the-secret' });
    });
    const deps: KeyVaultDeps = {
      fetch: fetchMock as unknown as typeof fetch,
      env: {
        IDENTITY_ENDPOINT: 'http://localhost/identity-endpoint',
        IDENTITY_HEADER: 'header-value',
      },
      now: () => 1000,
    };
    const p = new KeyVaultSecretProvider('https://v.vault.azure.net', deps);

    expect(await p.get('GITHUB_CLIENT_SECRET')).toBe('the-secret');
    // token endpoint carries the vault resource; secret read uses the kebab name.
    expect(calls[0]).toContain('resource=https%3A%2F%2Fvault.azure.net');
    expect(calls[1]).toContain('/secrets/github-client-secret?api-version=7.4');
  });

  it('caches the token across secret reads', async () => {
    let tokenCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('169.254.169.254')) {
        tokenCalls += 1;
        return jsonResponse({ access_token: 'tok', expires_on: '9999999999' });
      }
      return jsonResponse({ value: 'v' });
    });
    const p = new KeyVaultSecretProvider('https://v.vault.azure.net', {
      fetch: fetchMock as unknown as typeof fetch,
      env: {},
      now: () => 1000,
    });
    await p.get('A');
    await p.get('B');
    expect(tokenCalls).toBe(1);
  });

  it('returns undefined on a 404 secret', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('169.254.169.254')) {
        return jsonResponse({ access_token: 'tok', expires_on: '9999999999' });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    const p = new KeyVaultSecretProvider('https://v.vault.azure.net', {
      fetch: fetchMock as unknown as typeof fetch,
      env: {},
      now: () => 1000,
    });
    expect(await p.get('MISSING')).toBeUndefined();
  });
});
