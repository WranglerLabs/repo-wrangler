-- Onboarding wizard-loop fix — persist the GitHub App slug the manifest
-- conversion returns so a later page load (post-callback, or a fresh wizard
-- mount) can rebuild the install URL without re-running the manifest flow.
-- Only ever set for the exchange path; a pasted-credentials connection has
-- no discoverable slug and leaves this NULL.
ALTER TABLE provider_connections ADD COLUMN app_slug TEXT;
