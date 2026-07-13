import { describe, expect, it, vi } from 'vitest';
import { VaultSecretProvider } from '../src/vault';
import { GcpSecretManagerProvider } from '../src/gcp';
import { AwsSecretsManagerProvider } from '../src/aws';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('VaultSecretProvider (HashiCorp Vault, cloud-neutral)', () => {
  it('reads a KV v2 secret and maps env name to lower-kebab', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return json({ data: { data: { value: 'top-secret' } } });
    });
    const p = new VaultSecretProvider({
      address: 'https://vault.example.com:8200',
      token: 'tok',
      mount: 'secret',
      prefix: 'repo-wrangler/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await p.get('SESSION_SECRET')).toBe('top-secret');
    expect(calls[0]).toBe(
      'https://vault.example.com:8200/v1/secret/data/repo-wrangler/session-secret',
    );
  });

  it('returns undefined on a 404', async () => {
    const p = new VaultSecretProvider({
      address: 'https://v.example.com',
      token: 't',
      fetchImpl: (async () => json({ errors: [] }, 404)) as unknown as typeof fetch,
    });
    expect(await p.get('MISSING')).toBeUndefined();
  });
});

describe('GcpSecretManagerProvider', () => {
  it('gets a metadata token, then reads and base64-decodes the payload', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('metadata.google.internal')) {
        return json({ access_token: 'gtok', expires_in: 3600 });
      }
      return json({ payload: { data: btoa('the-value') } });
    });
    const p = new GcpSecretManagerProvider('my-proj', {
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });
    expect(await p.get('GITHUB_CLIENT_SECRET')).toBe('the-value');
    expect(calls[1]).toContain('/secrets/github-client-secret/versions/latest:access');
  });

  it('caches the token across reads', async () => {
    let tokenCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('metadata.google.internal')) {
        tokenCalls += 1;
        return json({ access_token: 't', expires_in: 3600 });
      }
      return json({ payload: { data: btoa('v') } });
    });
    const p = new GcpSecretManagerProvider('proj', {
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });
    await p.get('A');
    await p.get('B');
    expect(tokenCalls).toBe(1);
  });
});

describe('AwsSecretsManagerProvider (SigV4)', () => {
  it('signs the request and returns the SecretString', async () => {
    let seen: { url: string; headers: Headers; body: string } | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = {
        url: String(input),
        headers: new Headers(init?.headers),
        body: String(init?.body),
      };
      return json({ SecretString: 'aws-secret' });
    });
    const p = new AwsSecretsManagerProvider({
      region: 'us-east-1',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'shhh',
      prefix: 'repo-wrangler/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date('2026-07-13T12:00:00Z'),
    });
    expect(await p.get('SESSION_SECRET')).toBe('aws-secret');
    expect(seen!.url).toBe('https://secretsmanager.us-east-1.amazonaws.com/');
    expect(seen!.headers.get('x-amz-target')).toBe('secretsmanager.GetSecretValue');
    expect(seen!.body).toBe('{"SecretId":"repo-wrangler/session-secret"}');
    const auth = seen!.headers.get('authorization') ?? '';
    expect(auth).toContain('AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260713/us-east-1/secretsmanager/aws4_request');
    expect(auth).toContain('SignedHeaders=content-type;host;x-amz-date;x-amz-target');
    expect(auth).toMatch(/Signature=[0-9a-f]{64}/);
  });

  it('treats ResourceNotFound as absent', async () => {
    const p = new AwsSecretsManagerProvider({
      region: 'us-east-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 's',
      fetchImpl: (async () =>
        new Response('{"__type":"ResourceNotFoundException"}', { status: 400 })) as unknown as typeof fetch,
      now: () => new Date('2026-07-13T12:00:00Z'),
    });
    expect(await p.get('NOPE')).toBeUndefined();
  });
});
