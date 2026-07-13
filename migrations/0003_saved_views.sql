-- FR-012: saved views. Instance-scoped (shareable within the deployment); the
-- definition is an opaque serialized filter set the SPA understands.
CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
