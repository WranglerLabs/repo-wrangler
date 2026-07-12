import { Hono } from 'hono';
import {
  HANDLED_GITLAB_EVENTS,
  gitlabDeliveryFingerprint,
  translateGitLabEvent,
  verifyGitLabToken,
} from '@repo-wrangler/provider-gitlab';
import {
  markDeliveryProcessed,
  recordDeliveryIfNew,
} from '@repo-wrangler/persistence-d1';
import type { AppContext } from '../middleware/auth';
import { applyDomainEvents } from './apply';

const MAX_PAYLOAD_BYTES = 1_000_000;

/**
 * GitLab webhook receiver. GitLab uses a shared secret token header rather
 * than an HMAC signature, and has no delivery ID — a deterministic
 * fingerprint provides idempotency.
 */
export const gitlabWebhookRoutes = new Hono<AppContext>();

gitlabWebhookRoutes.post('/gitlab', async (c) => {
  const secret = c.env.GITLAB_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'GitLab webhooks are not configured.' }, 503);

  const event = c.req.header('x-gitlab-event');
  const token = c.req.header('x-gitlab-token') ?? null;
  if (!event) return c.json({ error: 'Missing webhook headers.' }, 400);
  if (!verifyGitLabToken(secret, token)) return c.json({ error: 'Invalid token.' }, 401);

  const rawBody = await c.req.text();
  if (rawBody.length > MAX_PAYLOAD_BYTES) return c.json({ error: 'Payload too large.' }, 413);
  if (!HANDLED_GITLAB_EVENTS.has(event)) return c.json({ ok: true, handled: false });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON.' }, 400);
  }

  const fingerprint = gitlabDeliveryFingerprint(event, payload);
  const repoExternalId = (payload as { project?: { id?: number } }).project?.id;
  const isNew = await recordDeliveryIfNew(
    c.env.DB,
    fingerprint,
    'gitlab',
    event,
    (payload as { object_attributes?: { action?: string } }).object_attributes?.action,
    repoExternalId !== undefined ? String(repoExternalId) : undefined,
  );
  if (!isNew) return c.json({ ok: true, duplicate: true });

  try {
    const events = translateGitLabEvent(event, payload);
    await applyDomainEvents(c.env.DB, events);
    await markDeliveryProcessed(c.env.DB, fingerprint);
    return c.json({ ok: true, applied: events.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    await markDeliveryProcessed(c.env.DB, fingerprint, message);
    return c.json({ ok: false, error: 'processing failed, reconciliation will repair' });
  }
});
