# RepoWrangler core decisions

A distilled summary of the key decisions from the RepoWrangler design. The full
pack — product requirements, architecture, security, data model, roadmap, and the
ADRs — is the [combined solution design](RepoWrangler-Solution-Design.md); the
[design pack index](design-pack-index.md) is the entry point.

## Core decisions

### Repository model

| Repository                                          | Visibility            | Purpose                                                                                                                 |
| --------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Hybrid-Solutions-Cloud/repo-wrangler`              | Public                | Complete open-source application, documentation, UI, Worker API, migrations, tests, and releases                        |
| `Hybrid-Solutions-Cloud/repo-wrangler-ops`          | Private, optional     | Your deployment runbooks, expected organization inventory, environment policy, recovery notes, and deployed-version pin |
| `Hybrid-Solutions-Cloud/gitactionboard`             | Public temporary fork | Upstream research, comparison, and provenance                                                                           |
| `Hybrid-Solutions-Cloud/git-pull-request-dashboard` | Public temporary fork | Upstream research, comparison, and provenance                                                                           |

The private operations repository will **not** contain a second copy of the application, provider credentials, GitHub App keys, GitLab tokens, or copied production data. Secrets belong in Cloudflare’s secret storage, while collected operational data belongs in D1.

### Recommended technology

* React, TypeScript, and Vite
* Cloudflare Workers with static assets
* Cloudflare D1
* Hono for the Worker API
* TanStack Query and TanStack Table
* A UI framework decision spike comparing shadcn/ui with MUI
* GitHub App authentication
* GitHub webhooks plus scheduled reconciliation
* Provider-neutral architecture for later GitLab support
* Mermaid diagrams stored with the source
* Lucidchart versions for polished architecture, workflow, and presentation diagrams
* Apache License 2.0 for RepoWrangler

Cloudflare’s current React guidance supports deploying the SPA and Worker API together as one full-stack application. The free Workers plan currently provides 100,000 requests per day, but its 10 ms CPU allowance and 50-subrequest limit mean collection must be event-driven and divided into small resumable jobs. D1’s free allowance is currently 5 million rows read daily, 100,000 rows written daily, and 5 GB of storage. ([Cloudflare Docs][2])omatic repository discovery

RepoWrangler will use a GitHub App installed with **All repositories** access in each organization. It will react to:

* New GitHub App installations
* Repositories added to or removed from an installation
* Newly created, transferred, renamed, archived, or deleted repositories
* Workflow and check events
* Pull requests and pushes
* Ruleset and branch-protection changes
* Security alerts

GitHub Apps can be installed for all repositories in an organization, and the relevant webhook events provide the automatic discovery path. RepoWrangler will also perform periodic reconciliation so a missed webhook cannot permanently leave the inventory incorrect. ([GitHub Docs][3])n product experience

The primary screen is designed as a **Repository Command Center** showing:

* Organizations and repositories
* Healthy, warning, critical, stale, and unknown counts
* Failed Actions and pipelines
* Branches ahead of or diverged from the default branch
* Open, blocked, stale, and recently merged PRs or MRs
* Security alerts
* Repositories without branch protections or rulesets
* Budget and metered-usage warnings
* Newly discovered repositories
* Repositories that have become inaccessible
* Provider synchronization health

Each repository then receives a detailed page with:

1. Overview and health explanation
2. Branch intelligence
3. Actions or pipelines
4. Pull requests or merge requests
5. Governance and rules
6. Security
7. Billing and usage
8. Activity history
9. Provider metadata
10. Synchronization status

GitHub’s budgets endpoint can expose organization and repository-scoped budget configuration where the authenticated GitHub App installation has organization Administration read access and the operator is an organization administrator or billing manager. ([GitHub Docs][4])Lab expansion

GitLab is built into the architecture from the beginning through a provider-neutral model:

```text
Provider
  └── Workspace
       └── Repository
            ├── Branch
            ├── Change request
            ├── Pipeline
            ├── Security finding
            └── Usage record
```

The first release focuses on GitHub, but GitLab groups, subgroups, projects, branches, pipelines, and merge requests can later plug into the same domain model. GitLab’s Groups API—including project discovery and subgroup traversal—is available on the Free tier. ([GitLab Docs][5])n-source reuse and credits

Both candidate upstream projects permit reuse:

* GitactionBoard uses Apache License 2.0.
* Git Pull Request Dashboard uses the MIT License.

The solution pack requires:

```text
LICENSE
NOTICE
THIRD_PARTY_NOTICES.md
CREDITS.md
credits.yaml
LICENSES/
```

It also specifies an in-product **Credits and Open Source** page showing:

* Project name and upstream repository
* License
* Copyright holder
* Exact source commit
* What was reused or adapted
* Files affected
* Modifications made
* Link to the corresponding license text

The latest upstream commits observed during planning were:

```text
GitactionBoard
960222d210b21f7423cff5032838e5da3c6cfc77

Git Pull Request Dashboard
6aa443f2b1562db7bbd5286a8b52292539093d42
```

The fork commands and provenance procedure are included in the documentation. I did **not** create the forks because the connected GitHub tooling available in this session does not expose repository creation or forking. The design recommends archiving those forks after the reuse audit rather than deleting them immediately, preserving a verifiable record of the source reviewed.

## Included documents

The pack contains dedicated documents for:

* Executive summary
* Product requirements
* Solution architecture
* GitHub, GitLab, and Cloudflare requirements
* Free-tier capacity and cost planning
* Security, authentication, and threat model
* Data model and synchronization
* Dashboard and repository-level UX
* Public/private repository strategy
* Upstream reuse and attribution
* Research spikes
* Development roadmap and backlog
* Expected code structure
* Mermaid and Lucid diagram strategy
* Implementation-readiness checklist
* Authoritative source register
* Ten architectural decision records

No production code has been generated. This is the complete planning baseline for building **RepoWrangler**.

[1]: https://developers.cloudflare.com/workers/platform/limits/ "Limits · Cloudflare Workers docs"
[2]: https://developers.cloudflare.com/workers/platform/pricing/ "Pricing · Cloudflare Workers docs"
[3]: https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app "Installing your own GitHub App - GitHub Docs"
[4]: https://docs.github.com/en/rest/billing/budgets "Budgets - GitHub Docs"
[5]: https://docs.gitlab.com/api/groups/ "Groups API | GitLab Docs"
