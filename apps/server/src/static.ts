/**
 * SPA static-file serving for the Node host.
 *
 * On Cloudflare the SPA is served by the assets runtime (`not_found_handling:
 * single-page-application` in wrangler.jsonc) and the Worker only handles the
 * API paths listed in `run_worker_first`. There is no static route inside the
 * Hono app, so the Node host has to serve `apps/web/dist` itself and fall back
 * to `index.html` for client-side routes — reproducing the same behaviour.
 */
import { readFile } from 'node:fs/promises';
import { normalize, join, extname, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** True for asset requests that must return 404, not the SPA shell. */
function looksLikeAsset(pathname: string): boolean {
  return extname(pathname) !== '' && !pathname.endsWith('.html');
}

export interface SpaAssets {
  /** Serve a static file, or the SPA shell for unmatched client routes. */
  serve(request: Request): Promise<Response>;
  /** A Cloudflare-`Fetcher`-shaped view, to satisfy the `ASSETS` binding. */
  fetcher: Fetcher;
}

/**
 * Create an SPA static server rooted at `distDir`. Hashed asset files 404 when
 * missing (so a bad bundle URL is visible); everything else falls back to
 * `index.html` so deep links like `/repositories/123` load the SPA.
 */
export function createSpaAssets(distDir: string): SpaAssets {
  const root = normalize(distDir);

  async function readIndex(): Promise<Response> {
    try {
      const html = await readFile(join(root, 'index.html'));
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    } catch {
      return new Response(
        'RepoWrangler SPA not built. Run `pnpm --filter @repo-wrangler/web build`.',
        { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }
  }

  async function serve(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // Resolve within root and guard against path traversal.
    const filePath = normalize(join(root, rel));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = await readFile(filePath);
      const headers: Record<string, string> = { 'content-type': contentType(filePath) };
      // Vite emits content-hashed asset filenames — safe to cache immutably.
      if (rel.startsWith('/assets/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
      return new Response(data, { status: 200, headers });
    } catch {
      if (looksLikeAsset(rel)) return new Response('Not found', { status: 404 });
      return readIndex();
    }
  }

  const fetcher = {
    fetch: (input: RequestInfo | URL) =>
      serve(input instanceof Request ? input : new Request(String(input))),
  } as unknown as Fetcher;

  return { serve, fetcher };
}
