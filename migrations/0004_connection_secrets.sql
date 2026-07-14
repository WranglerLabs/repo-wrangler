-- Onboarding design Phase B — the single justified schema addition. The
-- encrypted-at-rest home for provider credentials entered at runtime through
-- the wizard (ADR-021). `secret_reference` is the namespace pointer already
-- present (unused) on `provider_connections.secret_reference`.
CREATE TABLE IF NOT EXISTS connection_secrets (
  secret_reference TEXT NOT NULL,
  name             TEXT NOT NULL,
  ciphertext       TEXT NOT NULL,
  iv               TEXT NOT NULL,
  fingerprint      TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (secret_reference, name)
);
