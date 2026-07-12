# Creating your RepoWrangler GitHub App

Each operator creates and owns their own GitHub App — the open-source project
never sees your credentials.

## 1. Create the App

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.

### Personal account or organization?

**Either works — and a personal-account App is a first-class path, not a
fallback.** Because the App is created `public`, it can be *installed* on your
personal account **and** any organizations you belong to, regardless of which
account owns it.

- **Personal account (recommended for solo deployers):** create it at
  `https://github.com/settings/apps/new`. This always works.
- **Organization:** create it at
  `https://github.com/organizations/<org>/settings/apps/new`. This requires you
  to be an **owner** of that org — if you are not, GitHub returns a **404** on
  that URL (not a clear permission error). If you hit a 404 here, use the
  personal-account path instead; the result is equivalent.

RepoWrangler ships a one-tap **App Manifest** flow at `/setup/github-app` on your
deployment that pre-fills all of the fields below and offers both a
personal-account and an organization button — use it to skip the manual form.

| Field | Value |
|---|---|
| Name | `RepoWrangler` (or `RepoWrangler Dev` for development) |
| Homepage URL | Your deployment URL |
| Callback URL | `https://<your-worker>/auth/github/callback` |
| Webhook URL | `https://<your-worker>/webhooks/github` |
| Webhook secret | Generate a long random string — this becomes `GITHUB_WEBHOOK_SECRET` |
| Expire user authorization tokens | Enabled |

## 2. Permissions (read-only)

Repository permissions:

| Permission | Level |
|---|---|
| Metadata | Read |
| Contents | Read |
| Actions | Read |
| Checks | Read |
| Commit statuses | Read |
| Pull requests | Read |
| Administration | Read (branch protection / rulesets) |
| Code scanning alerts | Read (optional) |
| Dependabot alerts | Read (optional) |
| Secret scanning alerts | Read (optional) |

Organization permissions (optional, for budgets/billing in Phase 3):

| Permission | Level |
|---|---|
| Administration | Read |
| Members | Read |

**Request no write permissions.** Remediation features use a separate design
(ADR-008).

## 3. Webhook events

Subscribe to: `installation`, `installation_repositories`, `repository`,
`push`, `create`, `delete`, `pull_request`, `workflow_run`,
`code_scanning_alert`, `dependabot_alert`, `secret_scanning_alert`.

## 4. Collect credentials

- **App ID** — shown on the App page → `GITHUB_APP_ID`
- **Private key** — generate and download the `.pem` → `GITHUB_APP_PRIVATE_KEY`
  (paste the whole PEM including header/footer lines; both PKCS#1 and PKCS#8
  formats are accepted)
- **Client ID / Client secret** — for dashboard sign-in →
  `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`

Store all of these only as Cloudflare secrets (`wrangler secret put …`).

## 5. Install the App

Install on each organization (and/or your user account) with
**All repositories** so newly created repositories appear automatically. A
*selected repositories* installation works too, but new repos will not be
visible until you add them to the installation — RepoWrangler will only see
what the installation exposes.

## 6. Verify

1. Open your deployment and sign in (your GitHub login must be in
   `ALLOWED_GITHUB_USERS`).
2. Platform Health → **Run discovery now** (or wait for the next cron tick).
3. Create a scratch repository in a monitored organization — it should appear
   on the dashboard within moments via the `repository` webhook.
