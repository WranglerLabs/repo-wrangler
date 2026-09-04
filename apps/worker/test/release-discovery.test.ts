import { describe, expect, it, vi } from 'vitest';
import { fetchReleaseManifest } from '../src/lib/releases';

const legacyManifest = {
  schemaVersion: '1.0',
  product: 'RepoWrangler',
  version: 'v1.0.23',
  releasedAt: '2026-09-04T04:30:45Z',
  artifacts: [{
    target: 'azure-container-apps',
    url: 'https://example.test/repo-wrangler-aca-v1.0.23.tar.gz',
    sha256: 'c'.repeat(64),
    size: 4887,
    attestationUrl: 'https://example.test/provenance.sigstore.json',
    sbomUrl: 'https://example.test/repo-wrangler.spdx.json',
  }],
};

describe('release manifest discovery', () => {
  it('accepts the published v1.0 manifest without downloading artifacts', async () => {
    const fetcher = vi.fn(async () => Response.json(legacyManifest));
    const result = await fetchReleaseManifest('https://example.test/release-manifest.json', fetcher);
    expect(result).toMatchObject({ ok: true, manifest: { version: 'v1.0.23' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports unreachable or invalid metadata honestly', async () => {
    const unavailable = await fetchReleaseManifest('https://example.test/manifest.json',
      vi.fn(async () => new Response('no', { status: 503 })));
    expect(unavailable).toMatchObject({ ok: false, code: 'unavailable' });

    const invalid = await fetchReleaseManifest('https://example.test/manifest.json',
      vi.fn(async () => Response.json({ ...legacyManifest, product: 'Other' })));
    expect(invalid).toMatchObject({ ok: false, code: 'invalid_manifest' });
  });

  it('rejects unsupported sources before making a request', async () => {
    const fetcher = vi.fn();
    await expect(fetchReleaseManifest('http://example.test/manifest.json', fetcher))
      .resolves.toMatchObject({ ok: false, code: 'unsupported_source' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds stalled and oversized release metadata', async () => {
    const stalled = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(fetchReleaseManifest('https://example.test/manifest.json', stalled, 5))
      .resolves.toMatchObject({ ok: false, code: 'unavailable', detail: 'Release metadata request timed out.' });

    const oversized = vi.fn(async () => new Response('x', {
      headers: { 'content-length': '1048577' },
    }));
    await expect(fetchReleaseManifest('https://example.test/manifest.json', oversized))
      .resolves.toMatchObject({ ok: false, code: 'invalid_manifest', detail: 'Release metadata is too large.' });
  });
});
