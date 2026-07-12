-- RepoWrangler initial schema (migration 0001).
-- Provider-neutral core entities per the solution design: stable internal IDs,
-- provider external IDs stored separately, freshness metadata on every record,
-- deletion modelled as state transition (never destructive delete).

CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('github', 'gitlab', 'mock')),
  display_name TEXT NOT NULL,
  base_url TEXT,
  auth_type TEXT NOT NULL,
  external_account_id TEXT,
  secret_reference TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_success_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- GitHub organizations / user accounts (installation targets) or GitLab groups.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES provider_connections(id),
  external_id TEXT NOT NULL,
  installation_id TEXT,
  slug TEXT NOT NULL,
  display_name TEXT,
  kind TEXT NOT NULL DEFAULT 'organization',
  avatar_url TEXT,
  plan TEXT,
  monitoring_state TEXT NOT NULL DEFAULT 'monitored',
  capabilities TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reconciled_at TEXT,
  UNIQUE (connection_id, external_id)
);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  external_id TEXT NOT NULL,
  node_id TEXT,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  url TEXT,
  description TEXT,
  visibility TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_fork INTEGER NOT NULL DEFAULT 0,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  is_template INTEGER NOT NULL DEFAULT 0,
  default_branch TEXT,
  pushed_at TEXT,
  provider_updated_at TEXT,
  primary_language TEXT,
  topics TEXT,
  license_spdx TEXT,
  size_kb INTEGER,
  classification TEXT,
  monitoring_state TEXT NOT NULL DEFAULT 'monitored',
  -- active | inaccessible | removed — tombstone states, never hard-deleted.
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  snapshot_synced_at TEXT,
  enrich_synced_at TEXT,
  UNIQUE (workspace_id, external_id)
);

CREATE INDEX idx_repositories_workspace ON repositories (workspace_id, status);
CREATE INDEX idx_repositories_activity ON repositories (status, is_archived, pushed_at);
CREATE INDEX idx_repositories_full_name ON repositories (full_name);
CREATE INDEX idx_repositories_enrich ON repositories (status, monitoring_state, enrich_synced_at);

CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  name TEXT NOT NULL,
  head_sha TEXT,
  head_committed_at TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0,
  ahead_by INTEGER,
  behind_by INTEGER,
  -- identical | ahead | behind | diverged | unknown
  comparison_status TEXT,
  compared_at TEXT,
  open_change_request_number INTEGER,
  excluded INTEGER NOT NULL DEFAULT 0,
  excluded_reason TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, name)
);

CREATE INDEX idx_branches_repository ON branches (repository_id, status, excluded);

CREATE TABLE pipeline_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  external_id TEXT NOT NULL,
  name TEXT,
  status TEXT,
  conclusion TEXT,
  branch TEXT,
  head_sha TEXT,
  event TEXT,
  actor TEXT,
  url TEXT,
  run_started_at TEXT,
  completed_at TEXT,
  duration_seconds INTEGER,
  attempt INTEGER,
  failure_summary TEXT,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, external_id)
);

CREATE INDEX idx_pipeline_runs_repo_time ON pipeline_runs (repository_id, observed_at);
CREATE INDEX idx_pipeline_runs_repo_branch ON pipeline_runs (repository_id, branch, observed_at);

CREATE TABLE change_requests (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  number INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  author TEXT,
  is_draft INTEGER NOT NULL DEFAULT 0,
  -- open | merged | closed
  state TEXT NOT NULL DEFAULT 'open',
  base_ref TEXT,
  head_ref TEXT,
  head_sha TEXT,
  review_decision TEXT,
  requested_reviewers TEXT,
  mergeable_state TEXT,
  checks_status TEXT,
  created_at TEXT,
  updated_at TEXT,
  merged_at TEXT,
  closed_at TEXT,
  is_stale INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, number)
);

CREATE INDEX idx_change_requests_open ON change_requests (repository_id, state, updated_at);

CREATE TABLE security_findings (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  external_id TEXT NOT NULL,
  -- code_scanning | secret_scanning | dependency
  category TEXT NOT NULL,
  severity TEXT,
  state TEXT,
  rule_id TEXT,
  ref TEXT,
  url TEXT,
  -- Redacted summary only. Never store secret values or code snippets.
  summary TEXT,
  created_at TEXT,
  updated_at TEXT,
  resolved_at TEXT,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, category, external_id)
);

CREATE INDEX idx_security_findings_open ON security_findings (repository_id, state, severity);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  external_id TEXT NOT NULL,
  product TEXT,
  scope_type TEXT,
  scope_target TEXT,
  amount REAL,
  unit TEXT,
  prevent_further_usage INTEGER NOT NULL DEFAULT 0,
  alert_status TEXT,
  capability_state TEXT NOT NULL DEFAULT 'available',
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, external_id)
);

CREATE TABLE usage_daily (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  repository_id TEXT,
  usage_date TEXT NOT NULL,
  product TEXT,
  sku TEXT,
  unit TEXT,
  quantity REAL,
  gross_amount REAL,
  net_amount REAL,
  currency TEXT,
  UNIQUE (workspace_id, usage_date, product, sku, repository_id)
);

CREATE INDEX idx_usage_daily_scope ON usage_daily (workspace_id, usage_date);

-- Current health snapshot per repository (one row, replaced on evaluation).
CREATE TABLE health_snapshots (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
  -- critical | high | medium | low | healthy | unknown
  attention_level TEXT NOT NULL DEFAULT 'unknown',
  findings TEXT NOT NULL DEFAULT '[]',
  policy_version TEXT,
  evaluated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_health_snapshots_level ON health_snapshots (attention_level);

-- Webhook idempotency by provider delivery ID.
CREATE TABLE webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event TEXT NOT NULL,
  action TEXT,
  repository_external_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  error TEXT
);

CREATE INDEX idx_webhook_deliveries_time ON webhook_deliveries (received_at);

-- Checkpointed, resumable sync jobs — every scan is bounded and claimable.
CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  scope TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  cursor TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_eligible_at TEXT NOT NULL DEFAULT (datetime('now')),
  subrequests_used INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX idx_sync_jobs_eligible ON sync_jobs (state, priority, next_eligible_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Small key/value store for platform counters and instance settings.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
