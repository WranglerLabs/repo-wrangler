import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CREDITS } from '@repo-wrangler/credits';
import { recordAuditEvent } from '@repo-wrangler/persistence-d1';
import { appVersion, corsAllowedOrigins, isDemoMode, type Env } from './bindings';
import { apiRoutes } from './api/routes';
import { connectionRoutes } from './api/connections';
import {
  authConfig,
  ALL_PROVIDERS,
  isSessionProviderEnabled,
  isSetupMode,
} from './auth/registry';
import { setupRoutes } from './setup/manifest';
import { githubWebhookRoutes } from './webhooks/github';
import { gitlabWebhookRoutes } from './webhooks/gitlab';
import { internalCronRoutes } from './internal/cron';
import { requireAuth, securityHeaders, type AppContext } from './middleware/auth';
import { clearSessionCookie, readSession } from './lib/session';
import { runScheduled } from './scheduled';

const app = new Hono<AppContext>();

app.use('*', securityHeaders);

// CORS for decoupled-frontend deployments (ADR-011, Mode B). When
// CORS_ALLOWED_ORIGINS is empty (default, integrated Mode A) the allowlist is
// empty and no cross-origin request is granted access — same-origin is unaffected.
app.use('/api/*', (c, next) => {
  const allowed = corsAllowedOrigins(c.env);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept', 'X-Setup-Token'],
  })(c, next);
});
app.use('/auth/*', (c, next) => {
  const allowed = corsAllowedOrigins(c.env);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept', 'X-Setup-Token'],
  })(c, next);
});

// Liveness/readiness — no provider calls.
app.get('/health/live', (c) => c.json({ ok: true, version: appVersion(c.env) }));
app.get('/health/ready', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1 FROM meta LIMIT 1').first();
    return c.json({ ok: true, demoMode: isDemoMode(c.env) });
  } catch {
    return c.json({ ok: false, error: 'Database not ready — run migrations.' }, 503);
  }
});

// Public credits endpoint: attribution stays visible without a session.
app.get('/api/v1/credits', (c) => c.json(CREDITS));

// Public sign-in configuration so the SPA renders one button per enabled
// provider (GitHub, GitLab, Microsoft, Google, local-dev) without a session.
app.get('/auth/config', async (c) => {
  const setupMode = await isSetupMode(c.env);
  return c.json({
    ...(await authConfig(c.env)),
    version: appVersion(c.env),
    setupMode,
    setupTokenRequired: setupMode && Boolean(c.env.SETUP_TOKEN),
  });
});

// Shared session endpoints belong to the registry, not to any one provider.
app.post('/auth/logout', async (c) => {
  const secret = c.env.SESSION_SECRET;
  if (secret) {
    const user = await readSession(secret, c.req.header('cookie'));
    if (user) await recordAuditEvent(c.env.DB, user.login, 'logout');
  }
  c.header('Set-Cookie', clearSessionCookie(corsAllowedOrigins(c.env).length ? 'None' : 'Lax'));
  return c.json({ ok: true });
});

app.get('/auth/me', async (c) => {
  if (isDemoMode(c.env)) {
    return c.json({ login: 'demo', role: 'viewer', provider: 'demo', demo: true });
  }
  const secret = c.env.SESSION_SECRET;
  if (!secret) return c.json({ error: 'unconfigured' }, 500);
  const user = await readSession(secret, c.req.header('cookie'));
  if (!user || !(await isSessionProviderEnabled(c.env, user.provider))) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  return c.json(user);
});

// Mount every provider's routes; each handler guards on its own configuration,
// and the registry decides which appear on the sign-in screen.
for (const provider of ALL_PROVIDERS) app.route('/auth', provider.routes);
app.route('/setup', setupRoutes);
app.route('/webhooks', githubWebhookRoutes);
app.route('/webhooks', gitlabWebhookRoutes);
app.route('/internal', internalCronRoutes);

app.use('/api/v1/*', requireAuth);
app.route('/api/v1', apiRoutes);
app.route('/api/v1', connectionRoutes);

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env, controller.cron));
  },
} satisfies ExportedHandler<Env>;

// Re-exported so a non-Cloudflare host (apps/server) can run the same app and
// scheduler on any runtime. Portability seam — see ADR / design Portability.
export { app, runScheduled };
export { schedulerMode } from './bindings';
export type { Env };
