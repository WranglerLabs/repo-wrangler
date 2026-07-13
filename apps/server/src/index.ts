/**
 * RepoWrangler — Node server host (zero Cloudflare).
 *
 * Runs the exact same Hono app, API, providers, domain, and scheduler as the
 * Cloudflare Worker, but on a plain Node process backed by SQLite. This is the
 * reference realisation of the design's Portability section (ADR-011 /
 * ADR-013): swap the storage adapter and the host shell, keep everything above
 * unchanged. Deploy it with Docker/compose, on a home lab, a VM, Railway/Fly,
 * Azure Container Apps, or Kubernetes.
 *
 * Requires Node 22 with `--experimental-sqlite` (for `node:sqlite`).
 */
import { serve } from '@hono/node-server';
import { app, schedulerMode } from '@repo-wrangler/worker';
import { loadConfig, buildEnv, loadSecrets } from './env';
import { openStore } from './store';
import { createSpaAssets } from './static';
import { startScheduler } from './scheduler';

function log(message: string, error?: unknown): void {
  const line = `[repo-wrangler-server] ${message}`;
  if (error !== undefined) console.error(line, error);
  else console.log(line);
}

// Paths the shared Worker app owns; everything else is served as SPA static
// content. Mirrors wrangler.jsonc `assets.run_worker_first`.
const WORKER_PREFIXES = ['/api/', '/auth/', '/webhooks/', '/health/', '/setup/', '/internal/'];

function isWorkerPath(pathname: string): boolean {
  return WORKER_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p));
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Open the storage backend (SQLite by default, PostgreSQL when DATABASE_URL is
  // set) and apply migrations up front — the deployer never runs a migration
  // step by hand (parity with the Worker's auto-migrating deploy).
  const store = await openStore(config);
  log(`storage: ${store.label}`);
  const applied = await store.applyMigrations();
  log(
    applied.length
      ? `applied ${applied.length} migration(s): ${applied.join(', ')}`
      : 'database schema up to date',
  );

  // Resolve secrets through the configured provider (PN-4): env vars by default,
  // or Docker/K8s files or Azure Key Vault when SECRET_SOURCE selects them.
  const { label: secretLabel, secrets } = await loadSecrets();
  log(`secrets: ${secretLabel} (${Object.keys(secrets).length} resolved)`);

  const assets = createSpaAssets(config.webDist);
  const env = buildEnv(store.d1, assets.fetcher, secrets);

  // A minimal Cloudflare `ExecutionContext`. `waitUntil` keeps background work
  // alive on the Node event loop; nothing here is billed per-invocation.
  const executionCtx = {
    waitUntil(promise: Promise<unknown>) {
      void Promise.resolve(promise).catch((error) => log('waitUntil task failed', error));
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;

  const handler = (request: Request): Response | Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (isWorkerPath(pathname)) return app.fetch(request, env, executionCtx);
    return assets.serve(request);
  };

  const server = serve({ fetch: handler, port: config.port }, (info) => {
    log(`listening on http://0.0.0.0:${info.port}  (db: ${config.sqlitePath})`);
  });

  // Scheduler driver (PN-3): in-process timer by default; `external` expects an
  // outside ticker to POST /internal/cron/run; `off` disables scheduling. The
  // legacy ENABLE_SCHEDULER=false still forces it off.
  const mode = schedulerMode(env);
  const scheduler =
    config.enableScheduler && mode === 'in-process'
      ? startScheduler(env, log)
      : (log(`scheduler: ${config.enableScheduler ? mode : 'off (ENABLE_SCHEDULER=false)'} — no in-process timer`),
        null);

  const shutdown = (signal: string) => {
    log(`received ${signal}, shutting down`);
    scheduler?.stop();
    server.close(() => {
      void store.close().finally(() => process.exit(0));
    });
    // Hard-stop if a connection won't drain.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  log('fatal startup error', error);
  process.exit(1);
});
