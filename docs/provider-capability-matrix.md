# Provider capability matrix

What each **data provider** supports. RepoWrangler models capabilities explicitly:
where a provider can't supply something (plan, permissions, or product), the UI
shows a clear capability state rather than a blank or an error. This page is the
provider view; for the **deployment platform** matrix (features × hosting target)
see [deployment.md](deployment.md#capability-matrix--features-by-platform).

| Capability | GitHub | GitLab | Mock (demo) |
|---|---|---|---|
| Repository/project discovery | ✅ | ✅ | ✅ |
| Branch inventory & comparison | ✅ | ✅ | ✅ |
| Pull / merge requests | ✅ PRs | ✅ MRs | ✅ |
| Pipelines / workflow runs | ✅ Actions | ✅ CI/CD | ✅ |
| Security findings | ✅ code/secret/dependency scanning | ⚠️ where enabled | ✅ sample |
| Budgets & usage | ✅ (enhanced billing) | ⚠️ limited | ✅ sample |
| Webhooks (near-real-time) | ✅ | ✅ optional | n/a |
| Read-only guarantee | ✅ App, no write scopes | ✅ read-scoped token | ✅ |
| Sign-in (identity) | ✅ user-authorization | — | bypassed |
| Self-managed instances | GitHub Enterprise | ✅ `GITLAB_BASE_URL` | n/a |

Legend: ✅ supported · ⚠️ partial/plan-dependent · — not applicable.

## Capability states in the UI

For any capability, a repository/workspace shows one of:

- **available** — data is present and current.
- **unavailable** — the provider/plan doesn't offer it (e.g. security scanning off).
- **insufficient-permission** — the App/token lacks the scope to read it.
- **not-observed-yet** — not synced yet; will populate on the next sync.

This makes gaps explainable: an empty Security tab tells you *why* it's empty.

## Notes

- **GitHub budgets & usage** (FR-008) requires an organization on GitHub's
  enhanced billing platform; ingestion is validated against such an org.
- **GitLab** is enabled by `GITLAB_TOKEN` + `GITLAB_GROUPS`; security/usage depth
  depends on your GitLab tier and what's enabled per project.
- **Identity is independent of data:** you can monitor GitLab while signing in with
  [GitHub](providers/github-app.md) or [Entra ID](providers/entra.md).

## Roadmap

Additional providers (Azure DevOps, Bitbucket) are on the ecosystem roadmap
([ROADMAP.md](../ROADMAP.md), Phase 6). New providers implement the same
provider-neutral port — see the [developer guide](developer.md#add-a-data-provider).
