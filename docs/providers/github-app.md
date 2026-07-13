# Provider: GitHub App

GitHub is RepoWrangler's primary data provider and the default sign-in method.
Each operator creates and owns **their own** read-only GitHub App — the project
never sees your credentials ([ADR-003](../adr/README.md)).

## What it gives you

- Automatic discovery of every repository across the accounts/orgs the App is
  installed on.
- Branch, pull-request, workflow-run, security-alert, and budget/usage state.
- Near-real-time updates via webhooks, plus scheduled reconciliation.
- Sign-in: the App's user-authorization (OAuth) flow identifies who is signing in.

Everything is **read-only** — RepoWrangler requests no write scopes and performs
no write actions.

## 1. Create the App

Follow [setup/github-app.md](../setup/github-app.md) — it covers the personal vs
organization choice (personal-account is first-class), the exact permission set,
and the one-tap App Manifest flow at `/setup/github-app` on your deployment.

You end up with six values:

| Value | Setting |
|---|---|
| App ID | `GITHUB_APP_ID` |
| Private key (PEM) | `GITHUB_APP_PRIVATE_KEY` *(secret)* |
| OAuth client ID | `GITHUB_CLIENT_ID` |
| OAuth client secret | `GITHUB_CLIENT_SECRET` *(secret)* |
| Webhook secret | `GITHUB_WEBHOOK_SECRET` *(secret)* |
| — | plus `SESSION_SECRET` *(secret)*, `ALLOWED_GITHUB_USERS` |

## 2. Wire the values per target

The names are identical everywhere; only the store differs (see
[configuration.md](../configuration.md)):

- **Cloudflare:** `wrangler secret put GITHUB_APP_PRIVATE_KEY` (and the other
  secrets); non-secret values in `wrangler.jsonc` `vars`.
- **Docker / compose:** an un-committed `.env` at the repo root.
- **Azure Container Apps:** Key Vault references resolved by the app's managed
  identity (the recipe wires this).
- **Kubernetes:** a `Secret` for the secret values, a `ConfigMap` for the rest.

Set `DEMO_MODE=false` and `PUBLIC_BASE_URL` to your instance URL. The App's
webhook URL is `{PUBLIC_BASE_URL}/webhooks/github`; the OAuth callback is
`{PUBLIC_BASE_URL}/auth/github/callback`.

## 3. Install & first sign-in

1. Install the App on the accounts/orgs you want monitored.
2. Add your GitHub login to `ALLOWED_GITHUB_USERS` (comma-separated). The **first**
   login to sign in becomes the **owner**; the rest are **admins**.
3. Visit your instance and choose **Sign in with GitHub**. Not-allowlisted
   accounts are denied and the attempt is audited.

## 4. First sync

Discovery runs on the schedule (`*/15` incremental, `17 3` daily) and on webhook
deliveries. To pull immediately, an admin can trigger a manual sync from the
Administration page (`POST /api/v1/admin/sync`). See
[operations.md](../operations.md#sync).

## Scoping

- `ALLOWED_GITHUB_ORGS` (optional) restricts discovery to specific orgs.
- Archived/disabled repositories are tracked as tombstones, never hard-deleted.

## Troubleshooting

- **Org App URL 404s** — you are not an owner of that org; use the personal-account
  App path. See [setup/github-app.md](../setup/github-app.md).
- **Webhooks not arriving** — verify `GITHUB_WEBHOOK_SECRET` matches the App and
  the webhook URL is reachable; check `/api/v1/platform-health`.
- More in [troubleshooting.md](../troubleshooting.md).
