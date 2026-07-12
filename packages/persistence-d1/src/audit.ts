export async function recordAuditEvent(
  db: D1Database,
  actor: string,
  action: string,
  detail?: string,
): Promise<void> {
  await db
    .prepare(`INSERT INTO audit_events (id, actor, action, detail) VALUES (?1, ?2, ?3, ?4)`)
    .bind(crypto.randomUUID(), actor, action, detail ?? null)
    .run();
}
