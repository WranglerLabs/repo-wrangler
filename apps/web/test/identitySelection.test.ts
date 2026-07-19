import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureIdentity } from '../src/api/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('administrator identity selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts durable success when the POST response cannot be decoded', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('<html>stale intermediary response</html>', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ selectedProvider: 'github' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(configureIdentity({
      provider: 'github',
      allowedUsers: 'setup-owner',
    })).resolves.toEqual({ ok: true, provider: 'github' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries one ambiguous failed request when no identity was persisted', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ selectedProvider: null }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, provider: 'github' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(configureIdentity({
      provider: 'github',
      allowedUsers: 'setup-owner',
    })).resolves.toEqual({ ok: true, provider: 'github' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces the browser failure when persistence cannot be verified', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(jsonResponse({ selectedProvider: null }))
      .mockRejectedValueOnce(new TypeError('connection reset again'))
      .mockResolvedValueOnce(jsonResponse({ selectedProvider: null }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(configureIdentity({
      provider: 'github',
      allowedUsers: 'setup-owner',
    })).rejects.toThrow(
      'Could not verify that GitHub identity was saved: connection reset again',
    );
  });

  it('preserves explicit API errors without retrying', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      error: 'SECRET_ENCRYPTION_KEY is not configured.',
    }, 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(configureIdentity({
      provider: 'github',
      allowedUsers: 'setup-owner',
    })).rejects.toThrow('SECRET_ENCRYPTION_KEY is not configured.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
