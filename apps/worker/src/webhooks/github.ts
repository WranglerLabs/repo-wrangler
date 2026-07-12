import { Hono } from 'hono';
import {
  HANDLED_EVENTS,
  translateGitHubEvent,
  verifyGitHubSignature,
} from '@repo-wrangler/provider-github';
import {
  markDeliveryProcessed,
  recordDeliveryIfNew,
} from '@repo-wrangler/persistence-d1';
import type { AppContext } from '../middleware/auth';
import { applyDomainEvents } from './apply';

const MAX_PAYLOAD_BYTES = 1_000_000;

/**
 * GitHub App webhook receiver. Validates the signature over the raw body,
 * deduplicates by delivery ID, applies the compact update, and returns fast.
 */
export const githubWebhookRoutes = new Hono<AppContext>();

githubWebhookRoutes.post('/github', async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'Webhooks are not configured.' }, 503);

  const event = c.req.header('x-github-event');
  const deliveryId = c.req.header('x-github-delivery');
  const signature = c.req.header('x-hub-signature-256') ?? null;
  const contentType = c.req.header('content-type') ?? '';
  if (!event || !deliveryId) return c.json({ error: 'Missing webhook headers.' }, 400);
  if (!contentType.includes('application/json')) {
    return c.json({ error: 'Unsupported content type.' }, 415);
  }

  const rawBody = await c.req.text();
  if (rawBody.length > MAX_PAYLOAD_BYTES) return c.json({ error: 'Payload too large.' }, 413);

  if (!(await verifyGitHubSignature(secret, rawBody, signature))) {
    return c.json({ error: 'Invalid signature.' }, 401);
  }

  // Fast path: acknowledged but not subscribed-to.
  if (!HANDLED_EVENTS.has(event)) return c.json({ ok: true, handled: false });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON.' }, 400);
  }

  const action = (payload as { action?: string }).action;
  const repoExternalId = (payload as { repository?: { id?: number } }).repository?.id;

  const isNew = await recordDeliveryIfNew(
    c.env.DB,
    deliveryId,
    'github',
    event,
    action,
    repoExternalId !== undefined ? String(repoExternalId) : undefined,
  );
  if (!isNew) return c.json({ ok: true, duplicate: true });

  try {
    const events = translateGitHubEvent(event, payload);
    await applyDomainEvents(c.env.DB, events);
    await markDeliveryProcessed(c.env.DB, deliveryId);
    return c.json({ ok: true, applied: events.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    await markDeliveryProcessed(c.env.DB, deliveryId, message);
    // 200 so GitHub does not retry a payload that will fail identically;
    // reconciliation repairs any missed state.
    return c.json({ ok: false, error: 'processing failed, reconciliation will repair' });
  }
});
