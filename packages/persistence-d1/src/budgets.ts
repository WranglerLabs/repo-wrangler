import type { BudgetSnapshot } from '@repo-wrangler/domain';

export interface BudgetRow {
  id: string;
  workspace_id: string;
  external_id: string;
  product: string | null;
  scope_type: string | null;
  scope_target: string | null;
  amount: number | null;
  unit: string | null;
  prevent_further_usage: number;
  alert_status: string | null;
  capability_state: string;
  observed_at: string;
}

export async function upsertBudget(
  db: D1Database,
  workspaceId: string,
  budget: BudgetSnapshot,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO budgets (
         id, workspace_id, external_id, product, scope_type, scope_target,
         amount, unit, prevent_further_usage, alert_status, capability_state
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'available')
       ON CONFLICT (workspace_id, external_id) DO UPDATE SET
         product = excluded.product,
         scope_type = excluded.scope_type,
         scope_target = excluded.scope_target,
         amount = excluded.amount,
         unit = excluded.unit,
         prevent_further_usage = excluded.prevent_further_usage,
         alert_status = excluded.alert_status,
         capability_state = 'available',
         observed_at = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(),
      workspaceId,
      budget.externalId,
      budget.product ?? null,
      budget.scopeType ?? null,
      budget.scopeTarget ?? null,
      budget.amount ?? null,
      budget.unit ?? null,
      budget.preventFurtherUsage ? 1 : 0,
      budget.alertStatus ?? null,
    )
    .run();
}

export async function listWorkspaceBudgets(
  db: D1Database,
  workspaceId: string,
): Promise<BudgetRow[]> {
  const result = await db
    .prepare(`SELECT * FROM budgets WHERE workspace_id = ?1 ORDER BY product`)
    .bind(workspaceId)
    .all<BudgetRow>();
  return result.results;
}
