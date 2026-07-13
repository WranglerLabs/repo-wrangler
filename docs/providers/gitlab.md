# Provider: GitLab

RepoWrangler monitors GitLab estates through the provider-neutral core — the same
Command Center, Branches, Change Requests (merge requests), Pipelines, and health
views work across GitLab and GitHub. GitLab is **optional** and enabled purely by
configuration; a deployer may run GitHub-only, GitLab-only, or both.

Access is **read-only** — a read-scoped token, no write actions.

## What it gives you

- Discovery of projects across the groups/subgroups you list.
- Pipelines, merge requests, branch comparison, and unified estate views.
- Optional webhooks for near-real-time updates.

## 1. Create a read-only token

In GitLab, create a **personal, group, or project access token** (or an OAuth/
application token) with read scopes: `read_api` (and `read_repository` if you want
branch detail). For a whole estate, a **group access token** on each top-level
group you list is the cleanest.

## 2. Configure

| Setting | Secret | Description |
|---|---|---|
| `GITLAB_TOKEN` | **yes** | The read-only token. |
| `GITLAB_GROUPS` | no | Comma-separated top-level group paths to monitor (e.g. `acme,acme-labs`). |
| `GITLAB_BASE_URL` | no | Base URL for self-managed GitLab; defaults to `https://gitlab.com`. |
| `GITLAB_WEBHOOK_SECRET` | **yes, optional** | Verifies inbound GitLab webhook signatures. |

GitLab is considered configured when **both** `GITLAB_TOKEN` and `GITLAB_GROUPS`
are set. Wire the secret per target exactly as for GitHub (see
[configuration.md](../configuration.md)).

For self-managed GitLab, set `GITLAB_BASE_URL` to your instance
(e.g. `https://gitlab.example.com`).

## 3. Webhooks (optional)

Add a group/project webhook pointing at `{PUBLIC_BASE_URL}/webhooks/gitlab` with
the secret token set to `GITLAB_WEBHOOK_SECRET`. Choose push, merge-request, and
pipeline events. Without webhooks, GitLab still syncs on the schedule.

## 4. First sync

Discovery runs on the schedule and on webhook deliveries; an admin can trigger an
immediate sync from the Administration page. Projects appear in the unified estate
views alongside any GitHub repositories.

## Notes

- Sign-in identity is independent of the data provider: you can monitor GitLab
  while signing in with [GitHub](github-app.md) or [Entra ID](entra.md).
- Group tokens expire — rotate them per your policy and update `GITLAB_TOKEN`.
- More in [troubleshooting.md](../troubleshooting.md).
