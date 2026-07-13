# API reference

RepoWrangler exposes a small JSON HTTP API. The SPA is its only required client;
you can also call it directly. All responses are JSON. Paths are relative to your
instance origin (`PUBLIC_BASE_URL`), or to `VITE_API_BASE_URL` for a decoupled
SPA.

## Authentication

- **Session cookie.** Sign in via `/auth/*`; the API accepts the resulting
  HttpOnly `rw_session` cookie. Send credentials with cross-origin requests
  (`credentials: 'include'`) and register the SPA origin in
  `CORS_ALLOWED_ORIGINS`.
- **Demo mode.** When `DEMO_MODE=true`, `/api/v1/*` is served with a synthetic
  `demo` viewer — no sign-in needed.
- **Roles.** `owner` > `admin` > `viewer`. Mutating admin endpoints require
  `admin` or `owner`.

Unauthenticated calls to protected endpoints return `401`; insufficient role
returns `403`.

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health/live` | none | Liveness. `{ ok: true, version }`. No provider or DB calls. |
| GET | `/health/ready` | none | Readiness. `{ ok, demoMode }`; `503` if the DB/migrations aren't ready. |

## Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/config` | none | Active sign-in mode: `{ mode: 'github_app' \| 'entra', demo }`. |
| GET | `/auth/me` | cookie | Current session user, or `401`. In demo mode returns the demo viewer. |
| GET | `/auth/github/login` | none | Begin GitHub OAuth sign-in (redirect). |
| GET | `/auth/github/callback` | none | GitHub OAuth callback; sets the session cookie. |
| GET | `/auth/entra/login` | none | Begin Entra OIDC sign-in (redirect). `AUTH_MODE=entra`. |
| GET | `/auth/entra/callback` | none | Entra OIDC callback; sets the session cookie. |
| POST | `/auth/logout` | cookie | Clear the session. |

## Setup

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/setup/github-app` | none | One-tap GitHub App Manifest flow to create your own App. See [providers/github-app.md](providers/github-app.md). |

## Estate — read

All require an authenticated session (or demo mode). Prefixed `/api/v1`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/credits` | Open-source attribution (public — no session). |
| GET | `/api/v1/overview` | Command Center counts and headline metrics. |
| GET | `/api/v1/attention` | Repositories needing attention, most severe first. |
| GET | `/api/v1/repositories` | Estate repository list (filterable; virtualized in the UI). |
| GET | `/api/v1/repositories/:id` | Full repository detail (activity, branches, CRs, security, capabilities). |
| GET | `/api/v1/branches` | Estate-wide branch/comparison view. |
| GET | `/api/v1/change-requests` | Estate pull/merge requests. |
| GET | `/api/v1/pipelines` | Recent pipeline/workflow runs. |
| GET | `/api/v1/security` | Security findings across the estate. |
| GET | `/api/v1/budgets` | Budgets & usage across workspaces. |
| GET | `/api/v1/activity` | Recent activity feed. |
| GET | `/api/v1/workspaces` | Monitored workspaces (orgs/groups). |
| GET | `/api/v1/platform-health` | Instance health: sync jobs, webhooks, provider connection state. |
| GET | `/api/v1/about/credits` | In-product credits detail. |

## Saved views (FR-012)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/views` | session | List saved views (instance-scoped, shareable). |
| POST | `/api/v1/views` | session | Create a saved view `{ name, definition }`. |
| DELETE | `/api/v1/views/:id` | session | Delete a saved view. |

In demo mode, writes are accepted as no-ops.

## Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/admin/sync` | admin/owner | Trigger an immediate reconciliation sync. |

## Webhooks (provider → RepoWrangler)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/github` | signature | GitHub webhook receiver; verified with `GITHUB_WEBHOOK_SECRET`, idempotent by delivery ID. |
| POST | `/webhooks/gitlab` | signature | GitLab webhook receiver; verified with `GITLAB_WEBHOOK_SECRET`. |

## Export

The SPA offers CSV and Markdown export of the repository list (FR-014); these are
generated client-side from the list endpoints above.

## Notes

- Read endpoints reflect the **last synced snapshot**; freshness metadata is on
  each record. Trigger `/api/v1/admin/sync` or wait for the schedule/webhooks.
- Everything is read-only against providers — there is no endpoint that writes to
  GitHub or GitLab ([ADR-008](adr/README.md)).
