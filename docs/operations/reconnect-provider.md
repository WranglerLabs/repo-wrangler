# Runbook — Reconnect a provider

Use this when *Platform Health* shows a connection with a stale *last
success*, repeated auth errors, or `demoMode` unexpectedly `true`.

## GitHub

1. **Diagnose.** Common `last error` causes: revoked/expired private key,
   uninstalled App, suspended installation, or removed organization access.
2. **Credentials.** Confirm the Worker secrets are current
   (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`) — rotate per
   [rotate-github-app-key.md](rotate-github-app-key.md) if in doubt. Missing
   App credentials silently switch the instance to demo mode.
3. **Installation.** GitHub → Organization settings → GitHub Apps: the App
   must be installed and set to **All repositories** for automatic discovery.
   Re-install if it was removed; approve any pending permission requests.
4. **Webhooks.** App settings → Advanced shows recent deliveries. Redeliver a
   failed delivery; confirm the webhook URL is
   `https://<your-host>/webhooks/github` and the secret matches
   `GITHUB_WEBHOOK_SECRET`. Missed events are repaired by the next
   reconciliation regardless.
5. **Resync.** *Administration* → **Run discovery now**, then watch *Platform
   Health* for the connection to return to `active`.

## GitLab

1. Confirm `GITLAB_TOKEN` is valid (`read_api` scope, not expired) and
   `GITLAB_GROUPS` lists the intended top-level groups. For self-managed,
   check `GITLAB_BASE_URL`.
2. Rotate the token in GitLab, then `wrangler secret put GITLAB_TOKEN`.
3. GitLab webhooks are optional — scheduled reconciliation is the source of
   truth. If configured, verify the hook URL
   `https://<your-host>/webhooks/gitlab` and its secret token.
4. Resync from *Administration* and verify on *Platform Health*.

## Still failing

Check the Worker logs (`wrangler tail`) for the sanitized error category, and
provider status pages for outages. Data is never deleted on connection
failure — repositories mark inaccessible and recover automatically once the
connection returns.
