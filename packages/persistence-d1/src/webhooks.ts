/** Webhook idempotency: one row per provider delivery ID. */

export async function recordDeliveryIfNew(
  db: D1Database,
  deliveryId: string,
  provider: string,
  event: string,
  action: string | undefined,
  repositoryExternalId: string | undefined,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO webhook_deliveries
         (delivery_id, provider, event, action, repository_external_id)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(deliveryId, provider, event, action ?? null, repositoryExternalId ?? null)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function markDeliveryProcessed(
  db: D1Database,
  deliveryId: string,
  error?: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webhook_deliveries
       SET processed_at = datetime('now'), status = ?2, error = ?3
       WHERE delivery_id = ?1`,
    )
    .bind(deliveryId, error ? 'failed' : 'processed', error ?? null)
    .run();
}

export interface WebhookStats {
  received24h: number;
  failed24h: number;
}

export async function getWebhookStats(db: D1Database): Promise<WebhookStats> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM webhook_deliveries WHERE received_at >= datetime('now', '-1 day')) AS received24h,
         (SELECT COUNT(*) FROM webhook_deliveries WHERE received_at >= datetime('now', '-1 day')
            AND status = 'failed') AS failed24h`,
    )
    .first<WebhookStats>();
  return row ?? { received24h: 0, failed24h: 0 };
}

export async function compactWebhookDeliveries(db: D1Database, retentionDays: number): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM webhook_deliveries WHERE received_at < datetime('now', ?1)`)
    .bind(`-${retentionDays} days`)
    .run();
  return result.meta.changes ?? 0;
}
