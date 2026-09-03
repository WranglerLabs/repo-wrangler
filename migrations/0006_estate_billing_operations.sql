-- Complete provider reconciliation, connection operations, budgets, and usage.
-- Forward-only: previously published migrations remain unchanged.

ALTER TABLE provider_connections ADD COLUMN credential_source TEXT;
ALTER TABLE provider_connections ADD COLUMN capability_status TEXT;
ALTER TABLE provider_connections ADD COLUMN permission_details TEXT;
ALTER TABLE provider_connections ADD COLUMN last_discovery_at TEXT;
ALTER TABLE provider_connections ADD COLUMN last_billing_at TEXT;
ALTER TABLE provider_connections ADD COLUMN disabled_at TEXT;

-- Existing v1 connections with a writable secret reference were created by
-- the onboarding flow. Rows without one were backed by deployment settings.
UPDATE provider_connections
SET credential_source = CASE
  WHEN secret_reference IS NULL THEN 'environment'
  ELSE 'database'
END
WHERE credential_source IS NULL;

-- A process environment can expose only one credential set per provider.
-- Database-backed connections remain intentionally many-to-one.
CREATE UNIQUE INDEX idx_provider_connections_active_environment
ON provider_connections (provider_type)
WHERE credential_source = 'environment' AND status = 'active';

ALTER TABLE workspaces ADD COLUMN status_reason TEXT;
ALTER TABLE workspaces ADD COLUMN state_changed_at TEXT;
ALTER TABLE workspaces ADD COLUMN removed_at TEXT;
ALTER TABLE workspaces ADD COLUMN last_discovery_run_id TEXT;

ALTER TABLE repositories ADD COLUMN status_reason TEXT;
ALTER TABLE repositories ADD COLUMN state_changed_at TEXT;
ALTER TABLE repositories ADD COLUMN last_reconciled_at TEXT;
ALTER TABLE repositories ADD COLUMN last_discovery_run_id TEXT;

-- Stable provider identity is connection-specific and survives workspace moves.
CREATE TABLE repository_provider_identities (
  connection_id TEXT NOT NULL REFERENCES provider_connections(id),
  external_id TEXT NOT NULL,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (connection_id, external_id),
  UNIQUE (repository_id)
);

INSERT INTO repository_provider_identities (connection_id, external_id, repository_id, first_seen_at, last_seen_at)
SELECT w.connection_id, r.external_id, MIN(r.id), MIN(r.first_seen_at), MAX(r.last_seen_at)
FROM repositories r
JOIN workspaces w ON w.id = r.workspace_id
GROUP BY w.connection_id, r.external_id;

-- Preserve all legacy records while collapsing duplicate *active* identities
-- created when a project moved between workspaces. The canonical record keeps
-- the strictest monitoring choice and the full first/last-seen span; dependent
-- history on the old row remains queryable rather than being deleted.
UPDATE repositories
SET monitoring_state = 'ignored'
WHERE id IN (SELECT repository_id FROM repository_provider_identities)
  AND EXISTS (
    SELECT 1 FROM repositories duplicate
    JOIN workspaces duplicate_workspace ON duplicate_workspace.id = duplicate.workspace_id
    JOIN repository_provider_identities identity
      ON identity.connection_id = duplicate_workspace.connection_id
     AND identity.external_id = duplicate.external_id
    WHERE identity.repository_id = repositories.id AND duplicate.monitoring_state = 'ignored'
  );

UPDATE repositories
SET status = 'removed', status_reason = 'duplicate_merged',
    state_changed_at = datetime('now'), removed_at = COALESCE(removed_at, datetime('now'))
WHERE EXISTS (
  SELECT 1 FROM workspaces duplicate_workspace
  JOIN repository_provider_identities identity
    ON identity.connection_id = duplicate_workspace.connection_id
   AND identity.external_id = repositories.external_id
  WHERE duplicate_workspace.id = repositories.workspace_id
    AND identity.repository_id != repositories.id
);

CREATE TABLE repository_move_history (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  from_workspace_id TEXT REFERENCES workspaces(id),
  to_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider_full_name_before TEXT,
  provider_full_name_after TEXT,
  moved_at TEXT NOT NULL DEFAULT (datetime('now')),
  discovery_run_id TEXT
);

CREATE INDEX idx_repository_moves_repository ON repository_move_history (repository_id, moved_at);

-- A missing-resource transition is valid only after the applicable discovery
-- scope completed. Seen rows make this rule durable across checkpoints/retries.
CREATE TABLE discovery_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  connection_id TEXT REFERENCES provider_connections(id),
  workspace_id TEXT REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'pending',
  correlation_id TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  subrequests_used INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT,
  summary TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_detail TEXT,
  retry_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_discovery_runs_scope ON discovery_runs (connection_id, workspace_id, created_at);
CREATE INDEX idx_discovery_runs_status ON discovery_runs (status, created_at);

CREATE TABLE discovery_run_seen_workspaces (
  run_id TEXT NOT NULL REFERENCES discovery_runs(id),
  connection_id TEXT NOT NULL REFERENCES provider_connections(id),
  workspace_external_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id),
  repository_scan_completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, connection_id, workspace_external_id)
);

CREATE TABLE discovery_run_seen_repositories (
  run_id TEXT NOT NULL REFERENCES discovery_runs(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  repository_external_id TEXT NOT NULL,
  PRIMARY KEY (run_id, workspace_id, repository_external_id)
);

CREATE TABLE operation_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  operation_type TEXT NOT NULL,
  connection_id TEXT REFERENCES provider_connections(id),
  workspace_id TEXT REFERENCES workspaces(id),
  status TEXT NOT NULL DEFAULT 'pending',
  correlation_id TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  subrequests_used INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT,
  result_summary TEXT,
  error_code TEXT,
  error_detail TEXT,
  retry_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_operation_runs_status ON operation_runs (operation_type, status, created_at);
CREATE INDEX idx_operation_runs_scope ON operation_runs (connection_id, workspace_id, created_at);

CREATE TABLE provider_capabilities (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  capability TEXT NOT NULL,
  state TEXT NOT NULL,
  error_code TEXT,
  error_detail TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT,
  PRIMARY KEY (workspace_id, capability)
);

ALTER TABLE budgets ADD COLUMN budget_type TEXT;
ALTER TABLE budgets ADD COLUMN product_skus TEXT NOT NULL DEFAULT '[]';
ALTER TABLE budgets ADD COLUMN scope_entity_name TEXT;
ALTER TABLE budgets ADD COLUMN repository_id TEXT REFERENCES repositories(id);
ALTER TABLE budgets ADD COLUMN organization_name TEXT;
ALTER TABLE budgets ADD COLUMN user_login TEXT;
ALTER TABLE budgets ADD COLUMN alert_enabled INTEGER;
ALTER TABLE budgets ADD COLUMN alert_recipients TEXT NOT NULL DEFAULT '[]';
ALTER TABLE budgets ADD COLUMN last_successful_sync_at TEXT;

CREATE INDEX idx_budgets_repository ON budgets (repository_id, product);
CREATE INDEX idx_budgets_scope ON budgets (workspace_id, scope_type, product);

CREATE TABLE budget_repository_attributions (
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  attribution_type TEXT NOT NULL,
  PRIMARY KEY (budget_id, repository_id)
);

ALTER TABLE usage_daily ADD COLUMN unit_type TEXT;
ALTER TABLE usage_daily ADD COLUMN price_per_unit REAL;
ALTER TABLE usage_daily ADD COLUMN gross_quantity REAL;
ALTER TABLE usage_daily ADD COLUMN discount_quantity REAL;
ALTER TABLE usage_daily ADD COLUMN net_quantity REAL;
ALTER TABLE usage_daily ADD COLUMN discount_amount REAL;
ALTER TABLE usage_daily ADD COLUMN observed_at TEXT;
ALTER TABLE usage_daily ADD COLUMN import_run_id TEXT;
ALTER TABLE usage_daily ADD COLUMN source_key TEXT;
ALTER TABLE usage_daily ADD COLUMN organization_name TEXT;
ALTER TABLE usage_daily ADD COLUMN user_login TEXT;
ALTER TABLE usage_daily ADD COLUMN model TEXT;
ALTER TABLE usage_daily ADD COLUMN period_granularity TEXT NOT NULL DEFAULT 'day';

CREATE INDEX idx_usage_daily_repository ON usage_daily (repository_id, usage_date);
CREATE INDEX idx_usage_daily_product ON usage_daily (workspace_id, product, sku, usage_date);
CREATE UNIQUE INDEX idx_usage_daily_source ON usage_daily (workspace_id, source_key);

CREATE TABLE usage_imports (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  connection_id TEXT NOT NULL REFERENCES provider_connections(id),
  workspace_id TEXT REFERENCES workspaces(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  correlation_id TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  subrequests_used INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_detail TEXT,
  retry_eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_usage_imports_scope ON usage_imports (workspace_id, period_start, created_at);
CREATE INDEX idx_usage_imports_status ON usage_imports (status, created_at);
