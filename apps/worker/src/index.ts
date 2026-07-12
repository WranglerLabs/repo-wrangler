import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CREDITS } from '@repo-wrangler/credits';
import { APP_VERSION, corsAllowedOrigins, isDemoMode, type Env } from './bindings';
import { apiRoutes } from './api/routes';
import { authRoutes } from './auth/github';
import { setupRoutes } from './setup/manifest';
import { githubWebhookRoutes } from './webhooks/github';
import { gitlabWebhookRoutes } from './webhooks/gitlab';
import { requireAuth, securityHeaders, type AppContext } from './middleware/auth';
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
    allowHeaders: ['Content-Type', 'Accept'],
  })(c, next);
});
app.use('/auth/*', (c, next) => {
  const allowed = corsAllowedOrigins(c.env);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept'],
  })(c, next);
});

// Liveness/readiness — no provider calls.
app.get('/health/live', (c) => c.json({ ok: true, version: APP_VERSION }));
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

app.route('/auth', authRoutes);
app.route('/setup', setupRoutes);
app.route('/webhooks', githubWebhookRoutes);
app.route('/webhooks', gitlabWebhookRoutes);

app.use('/api/v1/*', requireAuth);
app.route('/api/v1', apiRoutes);

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env, controller.cron));
  },
} satisfies ExportedHandler<Env>;
