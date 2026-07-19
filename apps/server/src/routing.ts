// Paths the shared Worker app owns; everything else is served as SPA static
// content. Keep this list aligned with wrangler.jsonc `assets.run_worker_first`.
const WORKER_PREFIXES = ['/api/', '/auth/', '/webhooks/', '/health/', '/setup/', '/internal/'];

export function isWorkerPath(pathname: string): boolean {
  return WORKER_PREFIXES.some((prefix) =>
    pathname === prefix.slice(0, -1) || pathname.startsWith(prefix),
  );
}
