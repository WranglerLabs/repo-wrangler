import { Hono } from 'hono';
import {
  HANDLED_GITLAB_EVENTS,
  gitlabDeliveryFingerprint,
  translateGitLabEvent,
  verifyGitLabToken,
} from '@repo-wrangler/provider-gitlab';
import {
  listActiveConnectionsByType,
  markDeliveryProcessed,
  recordDeliveryIfNew,
} from '@repo-wrangler/persistence-d1';
import type { AppContext } from '../middleware/auth';
import { resolveGitLabWebhookSecret } from '../lib/connection-secrets';
import { applyDomainEvents } from './apply';

const MAX_PAYLOAD_BYTES = 1_000_000;

/**
 * GitLab webhook receiver. GitLab uses a shared secret token header rather
 * than an HMAC signature, and has no delivery ID — a deterministic
 * fingerprint provides idempotency.
 */
export const gitlabWebhookRoutes = new Hono<AppContext>();

gitlabWebhookRoutes.post('/gitlab', async (c) => {
  const event = c.req.header('x-gitlab-event');
  const token = c.req.header('x-gitlab-token') ?? null;
  if (!event) return c.json({ error: 'Missing webhook headers.' }, 400);

  const rawBody = await c.req.text();
  if (rawBody.length > MAX_PAYLOAD_BYTES) return c.json({ error: 'Payload too large.' }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON.' }, 400);
  }

  const connections = await listActiveConnectionsByType(c.env.DB, 'gitlab');
  const matchingConnectionIds: string[] = [];
  for (const connection of connections) {
    const secret = await resolveGitLabWebhookSecret(c.env, c.env.DB, connection.id);
    if (secret && verifyGitLabToken(secret, token)) matchingConnectionIds.push(connection.id);
  }
  let connectionId: string | undefined;
  if (matchingConnectionIds.length === 1) {
    connectionId = matchingConnectionIds[0];
  } else if (matchingConnectionIds.length > 1) {
    const projectId = (payload as { project?: { id?: number } }).project?.id;
    if (projectId !== undefined) {
      const scopedMatches: string[] = [];
      for (const candidateId of matchingConnectionIds) {
        const identity = await c.env.DB.prepare(
          `SELECT repository_id FROM repository_provider_identities
           WHERE connection_id = ?1 AND external_id = ?2`,
        ).bind(candidateId, String(projectId)).first<{ repository_id: string }>();
        if (identity) scopedMatches.push(candidateId);
      }
      if (scopedMatches.length === 1) connectionId = scopedMatches[0];
    }
    if (!connectionId) {
      return c.json({ error: 'Webhook matched multiple connections and its project scope is ambiguous.' }, 409);
    }
  } else if (connections.length === 0) {
    const environmentSecret = await resolveGitLabWebhookSecret(c.env, c.env.DB);
    if (!environmentSecret) return c.json({ error: 'GitLab webhooks are not configured.' }, 503);
    if (!verifyGitLabToken(environmentSecret, token)) return c.json({ error: 'Invalid token.' }, 401);
  } else {
    return c.json({ error: 'Invalid token.' }, 401);
  }

  if (!HANDLED_GITLAB_EVENTS.has(event)) return c.json({ ok: true, handled: false });

  // GitLab has no delivery ID. Scope the synthetic fingerprint to the owning
  // connection because separate instances can reuse project IDs and produce
  // byte-identical payloads.
  const fingerprint = `${connectionId ?? 'environment'}:${gitlabDeliveryFingerprint(event, payload)}`;
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
    await applyDomainEvents(c.env.DB, events, { connectionId });
    await markDeliveryProcessed(c.env.DB, fingerprint);
    return c.json({ ok: true, applied: events.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    await markDeliveryProcessed(c.env.DB, fingerprint, message);
    return c.json({ ok: false, error: 'processing failed, reconciliation will repair' });
  }
});
