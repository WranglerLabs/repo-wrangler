import { releaseManifestSchema } from '@repo-wrangler/contracts';
import type { RepoWranglerReleaseManifest } from '@repo-wrangler/domain';

export const DEFAULT_STABLE_RELEASE_MANIFEST_URL =
  'https://github.com/WranglerLabs/repo-wrangler/releases/latest/download/release-manifest.json';

export type ReleaseManifestFetchResult =
  | { ok: true; manifest: RepoWranglerReleaseManifest; fetchedAt: string }
  | { ok: false; code: 'unsupported_source' | 'unavailable' | 'invalid_manifest'; detail: string; fetchedAt: string };

function safeSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Fetch and validate metadata only. Artifacts are never downloaded here. */
export async function fetchReleaseManifest(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseManifestFetchResult> {
  const fetchedAt = new Date().toISOString();
  if (!safeSource(url)) {
    return { ok: false, code: 'unsupported_source', detail: 'Release metadata must use HTTPS.', fetchedAt };
  }
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': 'RepoWrangler release discovery' },
      redirect: 'follow',
    });
  } catch {
    return { ok: false, code: 'unavailable', detail: 'Release metadata could not be reached.', fetchedAt };
  }
  if (!response.ok) {
    return {
      ok: false, code: 'unavailable',
      detail: `Release metadata returned HTTP ${response.status}.`, fetchedAt,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'invalid_manifest', detail: 'Release metadata is not valid JSON.', fetchedAt };
  }
  const parsed = releaseManifestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false, code: 'invalid_manifest',
      detail: 'Release metadata failed the RepoWrangler manifest contract.', fetchedAt,
    };
  }
  return {
    ok: true,
    manifest: parsed.data as RepoWranglerReleaseManifest,
    fetchedAt,
  };
}
