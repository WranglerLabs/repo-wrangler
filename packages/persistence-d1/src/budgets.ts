import type {
  BudgetSnapshot, CapabilityState, CopilotSeatSnapshot, CopilotSubscriptionSnapshot,
} from '@repo-wrangler/domain';

export interface BudgetRow {
  id: string;
  workspace_id: string;
  external_id: string;
  budget_type: string | null;
  product: string | null;
  product_skus: string;
  scope_type: string | null;
  scope_target: string | null;
  scope_entity_name: string | null;
  repository_id: string | null;
  organization_name: string | null;
  user_login: string | null;
  amount: number | null;
  unit: string | null;
  prevent_further_usage: number;
  alert_enabled: number | null;
  alert_recipients: string;
  alert_status: string | null;
  capability_state: string;
  observed_at: string;
  last_successful_sync_at: string | null;
}

export interface ProviderCapabilityRow {
  workspace_id: string;
  capability: string;
  state: CapabilityState;
  error_code: string | null;
  error_detail: string | null;
  checked_at: string;
  last_success_at: string | null;
}

export interface CopilotSubscriptionRow {
  workspace_id: string;
  plan_type: string;
  seat_management_setting: string | null;
  total_seats: number;
  added_this_cycle: number | null;
  pending_invitation: number | null;
  pending_cancellation: number | null;
  active_this_cycle: number | null;
  inactive_this_cycle: number | null;
  ide_chat: string | null;
  platform_chat: string | null;
  cli: string | null;
  public_code_suggestions: string | null;
  observed_at: string;
  last_successful_sync_at: string;
}

export interface CopilotSeatRow {
  id: string;
  workspace_id: string;
  external_user_id: string;
  user_login: string;
  plan_type: string | null;
  assigning_team_slug: string | null;
  provider_created_at: string | null;
  provider_updated_at: string | null;
  pending_cancellation_at: string | null;
  last_activity_at: string | null;
  last_activity_editor: string | null;
  last_authenticated_at: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  state_changed_at: string | null;
  removed_at: string | null;
  last_successful_sync_at: string;
}

export async function replaceWorkspaceCopilotSeats(
  db: D1Database,
  workspaceId: string,
  seats: CopilotSeatSnapshot[],
): Promise<void> {
  for (const seat of seats) {
    await db.prepare(
      `INSERT INTO copilot_seats (
         id, workspace_id, external_user_id, user_login, plan_type, assigning_team_slug,
         provider_created_at, provider_updated_at, pending_cancellation_at,
         last_activity_at, last_activity_editor, last_authenticated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT (workspace_id, external_user_id) DO UPDATE SET
         user_login = excluded.user_login, plan_type = excluded.plan_type,
         assigning_team_slug = excluded.assigning_team_slug,
         provider_created_at = excluded.provider_created_at,
         provider_updated_at = excluded.provider_updated_at,
         pending_cancellation_at = excluded.pending_cancellation_at,
         last_activity_at = excluded.last_activity_at,
         last_activity_editor = excluded.last_activity_editor,
         last_authenticated_at = excluded.last_authenticated_at,
         status = 'active', last_seen_at = datetime('now'), removed_at = NULL,
         state_changed_at = CASE WHEN copilot_seats.status != 'active' THEN datetime('now')
                                 ELSE copilot_seats.state_changed_at END,
         last_successful_sync_at = datetime('now')`,
    ).bind(
      crypto.randomUUID(), workspaceId, seat.externalUserId, seat.userLogin,
      seat.planType ?? null, seat.assigningTeamSlug ?? null, seat.providerCreatedAt ?? null,
      seat.providerUpdatedAt ?? null, seat.pendingCancellationAt ?? null,
      seat.lastActivityAt ?? null, seat.lastActivityEditor ?? null,
      seat.lastAuthenticatedAt ?? null,
    ).run();
  }
  if (seats.length === 0) {
    await db.prepare(
      `UPDATE copilot_seats SET status = 'removed', state_changed_at = datetime('now'),
       removed_at = datetime('now'), last_successful_sync_at = datetime('now')
       WHERE workspace_id = ?1 AND status = 'active'`,
    ).bind(workspaceId).run();
    return;
  }
  const placeholders = seats.map((_, index) => `?${index + 2}`).join(', ');
  await db.prepare(
    `UPDATE copilot_seats SET status = 'removed', state_changed_at = datetime('now'),
     removed_at = datetime('now'), last_successful_sync_at = datetime('now')
     WHERE workspace_id = ?1 AND status = 'active' AND external_user_id NOT IN (${placeholders})`,
  ).bind(workspaceId, ...seats.map((seat) => seat.externalUserId)).run();
}

export async function upsertCopilotSubscription(
  db: D1Database,
  workspaceId: string,
  subscription: CopilotSubscriptionSnapshot,
): Promise<void> {
  await db.prepare(
    `INSERT INTO copilot_subscriptions (
       workspace_id, plan_type, seat_management_setting, total_seats,
       added_this_cycle, pending_invitation, pending_cancellation,
       active_this_cycle, inactive_this_cycle, ide_chat, platform_chat, cli,
       public_code_suggestions, observed_at, last_successful_sync_at
     ) VALUES (
       ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
       datetime('now'), datetime('now')
     ) ON CONFLICT (workspace_id) DO UPDATE SET
       plan_type = excluded.plan_type,
       seat_management_setting = excluded.seat_management_setting,
       total_seats = excluded.total_seats,
       added_this_cycle = excluded.added_this_cycle,
       pending_invitation = excluded.pending_invitation,
       pending_cancellation = excluded.pending_cancellation,
       active_this_cycle = excluded.active_this_cycle,
       inactive_this_cycle = excluded.inactive_this_cycle,
       ide_chat = excluded.ide_chat,
       platform_chat = excluded.platform_chat,
       cli = excluded.cli,
       public_code_suggestions = excluded.public_code_suggestions,
       observed_at = datetime('now'),
       last_successful_sync_at = datetime('now')`,
  ).bind(
    workspaceId, subscription.planType, subscription.seatManagementSetting ?? null,
    subscription.totalSeats, subscription.addedThisCycle ?? null,
    subscription.pendingInvitation ?? null, subscription.pendingCancellation ?? null,
    subscription.activeThisCycle ?? null, subscription.inactiveThisCycle ?? null,
    subscription.ideChat ?? null, subscription.platformChat ?? null,
    subscription.cli ?? null, subscription.publicCodeSuggestions ?? null,
  ).run();
}

export async function upsertBudget(
  db: D1Database,
  workspaceId: string,
  budget: BudgetSnapshot,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO budgets (
         id, workspace_id, external_id, budget_type, product, product_skus,
         scope_type, scope_target, scope_entity_name, repository_id,
         organization_name, user_login, amount, unit, prevent_further_usage,
         alert_enabled, alert_recipients, alert_status, capability_state,
         last_successful_sync_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
         (SELECT id FROM repositories
          WHERE workspace_id = ?2
            AND (lower(full_name) = lower(?10) OR lower(name) = lower(?10))
          ORDER BY CASE WHEN lower(full_name) = lower(?10) THEN 0 ELSE 1 END, id
          LIMIT 1),
         ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 'available', datetime('now')
       )
       ON CONFLICT (workspace_id, external_id) DO UPDATE SET
         budget_type = excluded.budget_type,
         product = excluded.product,
         product_skus = excluded.product_skus,
         scope_type = excluded.scope_type,
         scope_target = excluded.scope_target,
         scope_entity_name = excluded.scope_entity_name,
         repository_id = excluded.repository_id,
         organization_name = excluded.organization_name,
         user_login = excluded.user_login,
         amount = excluded.amount,
         unit = excluded.unit,
         prevent_further_usage = excluded.prevent_further_usage,
         alert_enabled = excluded.alert_enabled,
         alert_recipients = excluded.alert_recipients,
         alert_status = excluded.alert_status,
         capability_state = 'available',
         observed_at = datetime('now'),
         last_successful_sync_at = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(), workspaceId, budget.externalId, budget.budgetType ?? null,
      budget.product ?? null, JSON.stringify(budget.productSkus), budget.scopeType ?? null,
      budget.scopeTarget ?? null, budget.scopeEntityName ?? null, budget.repositoryFullName ?? '',
      budget.organizationName ?? null, budget.userLogin ?? null, budget.amount ?? null,
      budget.unit ?? null, budget.preventFurtherUsage ? 1 : 0,
      budget.alertEnabled === undefined ? null : budget.alertEnabled ? 1 : 0,
      JSON.stringify(budget.alertRecipients), budget.alertStatus ?? null,
    )
    .run();

  const stored = await db.prepare(
    `SELECT id, repository_id, lower(COALESCE(scope_type, '')) AS scope_type
     FROM budgets WHERE workspace_id = ?1 AND external_id = ?2`,
  ).bind(workspaceId, budget.externalId)
    .first<{ id: string; repository_id: string | null; scope_type: string }>();
  if (!stored) return;

  await db.prepare('DELETE FROM budget_repository_attributions WHERE budget_id = ?1')
    .bind(stored.id).run();
  if (stored.repository_id) {
    await db.prepare(
      `INSERT INTO budget_repository_attributions (budget_id, repository_id, attribution_type)
       VALUES (?1, ?2, 'direct') ON CONFLICT (budget_id, repository_id) DO UPDATE SET
         attribution_type = excluded.attribution_type`,
    ).bind(stored.id, stored.repository_id).run();
  } else if (['organization', 'org', 'enterprise', 'cost_center'].includes(stored.scope_type)) {
    await db.prepare(
      `INSERT INTO budget_repository_attributions (budget_id, repository_id, attribution_type)
       SELECT ?1, id, 'inherited' FROM repositories
       WHERE workspace_id = ?2 AND status = 'active'
       ON CONFLICT (budget_id, repository_id) DO UPDATE SET
         attribution_type = excluded.attribution_type`,
    ).bind(stored.id, workspaceId).run();
  }
}

/** Replace only after a complete successful provider response. */
export async function replaceWorkspaceBudgets(
  db: D1Database,
  workspaceId: string,
  budgets: BudgetSnapshot[],
): Promise<void> {
  for (const budget of budgets) await upsertBudget(db, workspaceId, budget);
  if (budgets.length === 0) {
    await db.prepare(
      `DELETE FROM budget_repository_attributions WHERE budget_id IN
       (SELECT id FROM budgets WHERE workspace_id = ?1)`,
    ).bind(workspaceId).run();
    await db.prepare('DELETE FROM budgets WHERE workspace_id = ?1').bind(workspaceId).run();
    return;
  }
  const placeholders = budgets.map((_, index) => `?${index + 2}`).join(', ');
  await db
    .prepare(`DELETE FROM budget_repository_attributions WHERE budget_id IN
      (SELECT id FROM budgets WHERE workspace_id = ?1 AND external_id NOT IN (${placeholders}))`)
    .bind(workspaceId, ...budgets.map((budget) => budget.externalId))
    .run();
  await db
    .prepare(`DELETE FROM budgets WHERE workspace_id = ?1 AND external_id NOT IN (${placeholders})`)
    .bind(workspaceId, ...budgets.map((budget) => budget.externalId))
    .run();
}

export async function setProviderCapability(
  db: D1Database,
  workspaceId: string,
  capability: string,
  state: CapabilityState,
  errorCode?: string,
  errorDetail?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO provider_capabilities (
         workspace_id, capability, state, error_code, error_detail, checked_at, last_success_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), CASE WHEN ?3 = 'available' THEN datetime('now') ELSE NULL END)
       ON CONFLICT (workspace_id, capability) DO UPDATE SET
         state = excluded.state,
         error_code = excluded.error_code,
         error_detail = excluded.error_detail,
         checked_at = datetime('now'),
         last_success_at = CASE
           WHEN excluded.state = 'available' THEN datetime('now')
           ELSE provider_capabilities.last_success_at
         END`,
    )
    .bind(workspaceId, capability, state, errorCode ?? null, errorDetail ?? null)
    .run();
}

export async function getProviderCapability(
  db: D1Database,
  workspaceId: string,
  capability: string,
): Promise<ProviderCapabilityRow | null> {
  return db.prepare('SELECT * FROM provider_capabilities WHERE workspace_id = ?1 AND capability = ?2')
    .bind(workspaceId, capability).first<ProviderCapabilityRow>();
}

export interface EstateCapabilityRow extends ProviderCapabilityRow {
  workspace_slug: string;
  provider: string;
}

export async function listProviderCapabilities(
  db: D1Database,
  capability: string,
): Promise<EstateCapabilityRow[]> {
  const result = await db.prepare(
    `SELECT pc.*, w.slug AS workspace_slug, c.provider_type AS provider
     FROM provider_capabilities pc
     JOIN workspaces w ON w.id = pc.workspace_id
     JOIN provider_connections c ON c.id = w.connection_id
     WHERE pc.capability = ?1 ORDER BY w.slug`,
  ).bind(capability).all<EstateCapabilityRow>();
  return result.results;
}

export interface EstateCopilotSubscriptionRow extends CopilotSubscriptionRow {
  workspace_slug: string;
  provider: string;
}

export interface EstateCopilotSeatRow extends CopilotSeatRow {
  workspace_slug: string;
  provider: string;
}

export async function listCopilotSeats(db: D1Database): Promise<EstateCopilotSeatRow[]> {
  const result = await db.prepare(
    `SELECT s.*, w.slug AS workspace_slug, c.provider_type AS provider
     FROM copilot_seats s
     JOIN workspaces w ON w.id = s.workspace_id
     JOIN provider_connections c ON c.id = w.connection_id
     ORDER BY w.slug, CASE s.status WHEN 'active' THEN 0 ELSE 1 END, s.user_login`,
  ).all<EstateCopilotSeatRow>();
  return result.results;
}

export async function listCopilotSubscriptions(db: D1Database): Promise<EstateCopilotSubscriptionRow[]> {
  const result = await db.prepare(
    `SELECT s.*, w.slug AS workspace_slug, c.provider_type AS provider
     FROM copilot_subscriptions s
     JOIN workspaces w ON w.id = s.workspace_id
     JOIN provider_connections c ON c.id = w.connection_id
     ORDER BY w.slug`,
  ).all<EstateCopilotSubscriptionRow>();
  return result.results;
}

export interface EstateBudgetRow extends BudgetRow {
  workspace_slug: string;
  provider: string;
}

export async function listAllBudgets(db: D1Database): Promise<EstateBudgetRow[]> {
  const result = await db
    .prepare(
      `SELECT b.*, w.slug AS workspace_slug, c.provider_type AS provider
       FROM budgets b
       JOIN workspaces w ON w.id = b.workspace_id
       JOIN provider_connections c ON c.id = w.connection_id
       ORDER BY w.slug, b.product, b.external_id`,
    ).all<EstateBudgetRow>();
  return result.results;
}

export async function listWorkspaceBudgets(db: D1Database, workspaceId: string): Promise<BudgetRow[]> {
  const result = await db.prepare('SELECT * FROM budgets WHERE workspace_id = ?1 ORDER BY product, external_id')
    .bind(workspaceId).all<BudgetRow>();
  return result.results;
}

export async function listApplicableRepositoryBudgets(
  db: D1Database,
  workspaceId: string,
  repositoryId: string,
): Promise<BudgetRow[]> {
  const result = await db
    .prepare(
      `SELECT b.* FROM budgets b
       JOIN budget_repository_attributions a ON a.budget_id = b.id
       WHERE b.workspace_id = ?1 AND a.repository_id = ?2
       ORDER BY CASE a.attribution_type WHEN 'direct' THEN 0 ELSE 1 END,
                b.product, b.external_id`,
    ).bind(workspaceId, repositoryId).all<BudgetRow>();
  return result.results;
}
