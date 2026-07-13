import { describe, expect, it, vi } from 'vitest';
import { CloudflareKvSecretProvider } from '../src/cloudflare-kv';
import { CyberArkSecretProvider } from '../src/cyberark';

describe('CloudflareKvSecretProvider', () => {
  it('reads a raw KV value and maps env name to lower-kebab key', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('the-value', { status: 200 });
    });
    const p = new CloudflareKvSecretProvider({
      accountId: 'acct1',
      namespaceId: 'ns1',
      apiToken: 'tok',
      prefix: 'repo-wrangler/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await p.get('SESSION_SECRET')).toBe('the-value');
    expect(calls[0]).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct1/storage/kv/namespaces/ns1/values/repo-wrangler%2Fsession-secret',
    );
  });

  it('returns undefined on a 404', async () => {
    const p = new CloudflareKvSecretProvider({
      accountId: 'a',
      namespaceId: 'n',
      apiToken: 't',
      fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    });
    expect(await p.get('MISSING')).toBeUndefined();
  });
});

describe('CyberArkSecretProvider (CCP/AIM)', () => {
  it('reads the Content field and maps env name to the CCP Object', async () => {
    let seen = '';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen = String(input);
      return new Response(JSON.stringify({ Content: 'pam-secret', UserName: 'svc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const p = new CyberArkSecretProvider({
      baseUrl: 'https://cyberark.example.com',
      appId: 'RepoWrangler',
      safe: 'RW-Safe',
      objectPrefix: 'rw-',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await p.get('GITHUB_CLIENT_SECRET')).toBe('pam-secret');
    expect(seen).toContain('/AIMWebService/api/Accounts?');
    expect(seen).toContain('AppID=RepoWrangler');
    expect(seen).toContain('Safe=RW-Safe');
    expect(seen).toContain('Object=rw-github-client-secret');
  });

  it('returns undefined when the object is not found (404)', async () => {
    const p = new CyberArkSecretProvider({
      baseUrl: 'https://cyberark.example.com',
      appId: 'A',
      safe: 'S',
      fetchImpl: (async () => new Response('APPAP004E', { status: 404 })) as unknown as typeof fetch,
    });
    expect(await p.get('NOPE')).toBeUndefined();
  });
});
