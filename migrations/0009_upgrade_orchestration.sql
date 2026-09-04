-- Durable, platform-neutral upgrade orchestration.
-- Execution remains the responsibility of an external deployment controller.

CREATE TABLE upgrade_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  lock_scope TEXT NOT NULL DEFAULT 'deployment',
  deployment_target TEXT NOT NULL,
  controller_type TEXT NOT NULL,
  controller_version TEXT,
  source_version TEXT NOT NULL,
  source_digest TEXT,
  target_version TEXT NOT NULL,
  target_digest TEXT NOT NULL,
  rollback_version TEXT,
  rollback_digest TEXT,
  state TEXT NOT NULL DEFAULT 'requested',
  actor_id TEXT NOT NULL,
  actor_display_name TEXT,
  correlation_id TEXT NOT NULL UNIQUE,
  controller_correlation_id TEXT,
  preflight_result TEXT,
  controller_evidence TEXT NOT NULL DEFAULT '{}',
  safe_error_code TEXT,
  safe_error_detail TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  cancel_requested_at TEXT,
  rollback_requested_at TEXT,
  last_observed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The database, not the UI, prevents two deployments from mutating the same
-- installation concurrently. Terminal outcomes release the lock.
CREATE UNIQUE INDEX idx_upgrade_jobs_active_lock
ON upgrade_jobs (lock_scope)
WHERE state NOT IN ('completed', 'canceled', 'failed', 'rolled_back');

CREATE INDEX idx_upgrade_jobs_requested
ON upgrade_jobs (requested_at, state);

CREATE TABLE upgrade_job_events (
  id TEXT PRIMARY KEY,
  upgrade_job_id TEXT NOT NULL REFERENCES upgrade_jobs(id),
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id TEXT,
  safe_detail TEXT,
  evidence TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (upgrade_job_id, sequence)
);

CREATE INDEX idx_upgrade_job_events_job
ON upgrade_job_events (upgrade_job_id, sequence);
