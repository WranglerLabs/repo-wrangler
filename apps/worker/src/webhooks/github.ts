import { Hono } from 'hono';
import {
  HANDLED_EVENTS,
  translateGitHubEvent,
  verifyGitHubSignature,
} from '@repo-wrangler/provider-github';
import {
  getWorkspaceByConnectionAndExternalId,
  listActiveConnectionsByType,
  markWorkspaceState,
  markDeliveryProcessed,
  recordDeliveryIfNew,
} from '@repo-wrangler/persistence-d1';
import type { AppContext } from '../middleware/auth';
import { resolveGitHubAppCredentials } from '../lib/connection-secrets';
import { applyDomainEvents } from './apply';

const MAX_PAYLOAD_BYTES = 1_000_000;

/**
 * GitHub App webhook receiver. Validates the signature over the raw body,
 * deduplicates by delivery ID, applies the compact update, and returns fast.
 */
export const githubWebhookRoutes = new Hono<AppContext>();

githubWebhookRoutes.post('/github', async (c) => {
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

  // Verify against each active GitHub App independently. This both supports
  // multiple Apps and identifies the connection that owns the delivery.
  const connections = await listActiveConnectionsByType(c.env.DB, 'github');
  let connectionId: string | undefined;
  let signatureValid = false;
  const matchingConnectionIds: string[] = [];
  for (const connection of connections) {
    const credentials = await resolveGitHubAppCredentials(c.env, c.env.DB, connection.id);
    if (credentials?.webhookSecret
      && await verifyGitHubSignature(credentials.webhookSecret, rawBody, signature)) {
      connectionId = connection.id;
      signatureValid = true;
      matchingConnectionIds.push(connection.id);
    }
  }
  if (connections.length === 0) {
    const credentials = await resolveGitHubAppCredentials(c.env, c.env.DB);
    signatureValid = Boolean(credentials?.webhookSecret
      && await verifyGitHubSignature(credentials.webhookSecret, rawBody, signature));
  }
  if (!signatureValid) {
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

  if (matchingConnectionIds.length === 1) {
    connectionId = matchingConnectionIds[0];
  } else if (matchingConnectionIds.length > 1) {
    const installation = (payload as {
      installation?: { id?: number; account?: { id?: number } };
    }).installation;
    const installationId = installation?.id === undefined ? null : String(installation.id);
    const accountId = installation?.account?.id === undefined ? null : String(installation.account.id);
    const matches: string[] = [];
    for (const candidateId of matchingConnectionIds) {
      const workspace = await c.env.DB.prepare(
        `SELECT id FROM workspaces WHERE connection_id = ?1
           AND ((?2 IS NOT NULL AND installation_id = ?2)
             OR (?3 IS NOT NULL AND external_id = ?3))`,
      ).bind(candidateId, installationId, accountId).first<{ id: string }>();
      if (workspace) matches.push(candidateId);
    }
    if (matches.length !== 1) {
      return c.json({ error: 'Webhook matched multiple connections and its installation scope is ambiguous.' }, 409);
    }
    connectionId = matches[0];
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
    if (connectionId && event === 'installation' && (action === 'deleted' || action === 'suspend')) {
      const accountId = (payload as { installation?: { account?: { id?: number } } })
        .installation?.account?.id;
      if (accountId !== undefined) {
        const workspace = await getWorkspaceByConnectionAndExternalId(
          c.env.DB, connectionId, String(accountId),
        );
        if (workspace) {
          await markWorkspaceState(c.env.DB, workspace.id, 'inaccessible',
            action === 'deleted' ? 'app_uninstalled' : 'permission_lost');
        }
      }
    }
    const events = translateGitHubEvent(event, payload);
    await applyDomainEvents(c.env.DB, events, { connectionId });
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
