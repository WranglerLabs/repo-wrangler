-- Persist organization-wide Copilot subscription metadata separately from
-- explicitly configured metered budgets.

CREATE TABLE copilot_subscriptions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  plan_type TEXT NOT NULL,
  seat_management_setting TEXT,
  total_seats INTEGER NOT NULL,
  added_this_cycle INTEGER,
  pending_invitation INTEGER,
  pending_cancellation INTEGER,
  active_this_cycle INTEGER,
  inactive_this_cycle INTEGER,
  ide_chat TEXT,
  platform_chat TEXT,
  cli TEXT,
  public_code_suggestions TEXT,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_successful_sync_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_copilot_subscriptions_plan ON copilot_subscriptions (plan_type);
