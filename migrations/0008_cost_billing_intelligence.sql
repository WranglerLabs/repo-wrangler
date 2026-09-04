-- Cost and billing intelligence: durable Copilot seat lifecycle.
-- Forward-only; provider failures never remove the last successful snapshot.

CREATE TABLE copilot_seats (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  external_user_id TEXT NOT NULL,
  user_login TEXT NOT NULL,
  plan_type TEXT,
  assigning_team_slug TEXT,
  provider_created_at TEXT,
  provider_updated_at TEXT,
  pending_cancellation_at TEXT,
  last_activity_at TEXT,
  last_activity_editor TEXT,
  last_authenticated_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  state_changed_at TEXT,
  removed_at TEXT,
  last_successful_sync_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, external_user_id)
);

CREATE INDEX idx_copilot_seats_workspace_status
ON copilot_seats (workspace_id, status, last_activity_at);

CREATE INDEX idx_copilot_seats_user
ON copilot_seats (user_login, status);
