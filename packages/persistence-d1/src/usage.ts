import type { UsageSnapshot } from '@repo-wrangler/domain';

export interface UsageRow {
  id: string;
  workspace_id: string;
  repository_id: string | null;
  usage_date: string;
  product: string;
  sku: string;
  unit_type: string | null;
  price_per_unit: number | null;
  quantity: number | null;
  gross_quantity: number | null;
  discount_quantity: number | null;
  net_quantity: number | null;
  gross_amount: number | null;
  discount_amount: number | null;
  net_amount: number | null;
  currency: string | null;
  organization_name: string | null;
  user_login: string | null;
  model: string | null;
  observed_at: string;
  period_granularity: string;
}

function sourceKey(item: UsageSnapshot): string {
  return [item.usageDate, item.product, item.sku, item.repositoryFullName ?? '',
    item.userLogin ?? '', item.model ?? '', item.unitType ?? '', item.periodGranularity].join('\u001f');
}

export async function upsertUsage(
  db: D1Database,
  workspaceId: string,
  item: UsageSnapshot,
  importRunId?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage_daily (
         id, workspace_id, repository_id, usage_date, product, sku, unit,
         quantity, gross_amount, net_amount, currency, unit_type, price_per_unit,
         gross_quantity, discount_quantity, net_quantity, discount_amount,
         observed_at, import_run_id, source_key, organization_name, user_login, model,
         period_granularity
       ) VALUES (
         ?1, ?2, (SELECT id FROM repositories WHERE workspace_id = ?2 AND lower(full_name) = lower(?3) LIMIT 1),
         ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
         ?18, ?19, ?20, ?21, ?22, ?23, ?24
       )
       ON CONFLICT (workspace_id, source_key) DO UPDATE SET
         repository_id = excluded.repository_id, quantity = excluded.quantity,
         gross_amount = excluded.gross_amount, net_amount = excluded.net_amount,
         currency = excluded.currency, unit_type = excluded.unit_type,
         price_per_unit = excluded.price_per_unit, gross_quantity = excluded.gross_quantity,
         discount_quantity = excluded.discount_quantity, net_quantity = excluded.net_quantity,
         discount_amount = excluded.discount_amount, observed_at = excluded.observed_at,
         import_run_id = excluded.import_run_id, organization_name = excluded.organization_name,
         user_login = excluded.user_login, model = excluded.model,
         period_granularity = excluded.period_granularity`,
    )
    .bind(
      crypto.randomUUID(), workspaceId, item.repositoryFullName ?? '', item.usageDate,
      item.product, item.sku, item.unitType ?? null, item.quantity ?? null,
      item.grossAmount ?? null, item.netAmount ?? null, item.currency ?? null,
      item.unitType ?? null, item.pricePerUnit ?? null, item.grossQuantity ?? null,
      item.discountQuantity ?? null, item.netQuantity ?? null, item.discountAmount ?? null,
      item.observedAt, importRunId ?? null, sourceKey(item), item.organizationName ?? null,
      item.userLogin ?? null, item.model ?? null, item.periodGranularity,
    ).run();
}

export async function upsertWorkspaceUsage(
  db: D1Database,
  workspaceId: string,
  snapshots: UsageSnapshot[],
  importRunId?: string,
): Promise<void> {
  for (const snapshot of snapshots) await upsertUsage(db, workspaceId, snapshot, importRunId);
}

/** Replace a successfully fetched billing period so provider corrections and removals converge. */
export async function replaceWorkspaceUsagePeriod(
  db: D1Database,
  workspaceId: string,
  periodStart: string,
  periodEnd: string,
  snapshots: UsageSnapshot[],
  importRunId?: string,
): Promise<void> {
  const replacementRunId = importRunId ?? crypto.randomUUID();
  await upsertWorkspaceUsage(db, workspaceId, snapshots, replacementRunId);
  await db.prepare(
    `DELETE FROM usage_daily WHERE workspace_id = ?1 AND usage_date >= ?2 AND usage_date <= ?3
       AND COALESCE(import_run_id, '') != ?4`,
  ).bind(workspaceId, periodStart, periodEnd, replacementRunId).run();
}

export async function listUsage(
  db: D1Database,
  filters: { workspaceId?: string; repositoryId?: string; from?: string; to?: string } = {},
): Promise<UsageRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM usage_daily
       WHERE (?1 IS NULL OR workspace_id = ?1) AND (?2 IS NULL OR repository_id = ?2)
         AND (?3 IS NULL OR usage_date >= ?3) AND (?4 IS NULL OR usage_date <= ?4)
       ORDER BY usage_date DESC, product, sku`,
    ).bind(filters.workspaceId ?? null, filters.repositoryId ?? null,
      filters.from ?? null, filters.to ?? null).all<UsageRow>();
  return result.results;
}

export interface EstateUsageRow extends UsageRow {
  workspace_slug: string;
  provider: string;
  repository_full_name: string | null;
}

export async function listEstateUsage(
  db: D1Database,
  filters: { from?: string; to?: string } = {},
): Promise<EstateUsageRow[]> {
  const result = await db.prepare(
    `SELECT u.*, w.slug AS workspace_slug, c.provider_type AS provider,
            r.full_name AS repository_full_name
     FROM usage_daily u
     JOIN workspaces w ON w.id = u.workspace_id
     JOIN provider_connections c ON c.id = w.connection_id
     LEFT JOIN repositories r ON r.id = u.repository_id
     WHERE (?1 IS NULL OR u.usage_date >= ?1) AND (?2 IS NULL OR u.usage_date <= ?2)
     ORDER BY u.usage_date DESC, u.net_amount DESC, u.product, u.sku`,
  ).bind(filters.from ?? null, filters.to ?? null).all<EstateUsageRow>();
  return result.results;
}
