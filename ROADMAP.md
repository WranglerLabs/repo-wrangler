# Roadmap

RepoWrangler's roadmap is organized by confidence, not promised dates:

- **Now** — active release work.
- **Next** — ranked work intended to follow the release.
- **Later** — directional investments whose order may change.
- **Shipped** — capabilities already available today.

For exact release contents, see the [changelog](CHANGELOG.md) and
[release notes](https://wranglerlabs.org/releases/).

## At a glance

| Horizon | Focus | Intended outcome |
|---|---|---|
| **Now** | Stabilize the v1.0 GA line and respond to operator feedback | A dependable latest-patch release with verified upgrade and rollback guidance |
| **Next** | Make setup, access, and operations easier | A new operator can deploy confidently, add users, and understand sync health without editing configuration or querying the database |
| **Later** | Scale administration, security, providers, and cost visibility | RepoWrangler grows from a strong estate dashboard into a broader operations platform |

---

## Now — stabilize v1.0 GA

**Status: GA.** RepoWrangler v1.0.8 is the current supported patch release.
The immediate focus is operator feedback, reproducible deployment recipes,
upgrade safety, and correction of release-blocking defects. Support is
best-effort and targets the latest patch release only.

---

## Next — ranked post-release work

Work is expected to proceed in this order. The ordering is deliberate; a new
item entering this list should displace or move an existing item.

| Priority | Initiative | Outcome | Key dependency |
|---:|---|---|---|
| 1 | **Guided Bootstrap Installer** | One command opens a local wizard, asks only for required inputs, deploys to the selected target, and returns the final URL | Current release; existing tier picker |
| 2 | **Invite and manage users** | Administrators add or remove allowed identities in the UI without editing environment variables or restarting | Provider identity model |
| 3 | **Operations and sync history** | Administration shows discovery runs, queue state, failures, duration, and repositories found—no direct database queries required | Existing sync-job data |
| 4 | **Faster enrichment after discovery** | Newly discovered repositories receive branch, PR/MR, pipeline, security, and billing data promptly instead of trickling in | Existing rate-limit and job-budget controls |
| 5 | **Budget settings audit** | Operators see organization and repository budget settings, plus a clear capability message when provider credentials cannot read them | GitHub billing API capability probe |
| 6 | **GitLab URL normalization** | Pasting a group URL safely resolves to the GitLab origin and produces accurate authentication versus connectivity errors | None |
| 7 | **Per-connection scope picker** | Operators explicitly select which visible organizations or groups a connection monitors | Existing grow-estate flow |

### Guided Bootstrap Installer

The installer is the headline next step. A PowerShell or bash bootstrap command
will open a local React wizard where the operator selects a target—Cloudflare,
Docker, Azure Container Apps, Kubernetes, or Azure SWA—plus demo/real mode,
authentication, secret storage, region, scale, and optional CAF naming presets.
The wizard will generate one reusable configuration document, stream deployment
progress, and return the running URL.

The installer owns the configuration schema and deployment automation so those
systems are designed once rather than as separate, competing projects.

---

## Later — directional investments

### Security, deployment, and scale

| Initiative | Intended outcome |
|---|---|
| **Credentials & Access** | Inventory every configured credential without exposing its value; verify live reach and flag failing, unused, or over-scoped access |
| Multiple connections per provider | Support separate Apps, tokens, organizations, groups, and health state for each connection |
| Tier 3 architecture | Compose the existing platform-neutral foundations into a hardened enterprise topology with private networking, HA data, observability, SSO, and RBAC |
| Deployment automation and pipelines | Ship opt-in GitHub Actions and Azure DevOps templates that consume the bootstrap installer's configuration schema |

### Ecosystem and observability

| Initiative | Intended outcome |
|---|---|
| Notifications and controlled operations | Teams, Slack, and Discord notifications; acknowledgements, quiet hours, and a separate guarded write path for reruns |
| Azure DevOps provider | Add Azure Repos, Pipelines, and pull requests as the next repository provider |
| Additional repository providers | Add Bitbucket, Gitea, and Forgejo behind the existing provider interfaces |
| MCP server and role-based views | Expose estate data to AI clients and tailor views to signed-in user roles |
| Actual cost and quota visibility | Tie Cloudflare and Azure spend to deployed applications and repositories; show projected spend and free-tier consumption |
| Cache, notification, and job seams | Formalize `ICacheProvider`, `INotificationProvider`, and `IBackgroundJobProvider` with production adapters |

### Important dependencies

- The bootstrap installer owns the shared configuration schema used by future
  deployment pipelines.
- User management establishes the identity model needed by role-based views.
- Cost and budget work must surface provider capability honestly when a token
  cannot access billing APIs.
- Tier 3 work builds on the platform-neutral adapters that already ship; it does
  not replace them.

---

## Shipped

### Recent product work

- **Large-estate navigation** — repository and workspace search, filter, sort,
  and pagination controls keep hundreds of repositories and roughly 100
  workspaces manageable.
- **Estate Scope usability** — connection sections collapse cleanly and a
  prominent action starts another provider connection from Estate Scope or
  Administration.
- **Deployment clarity and clean PostgreSQL boot** — ACA inputs and exact Key
  Vault secret names appear before deployment steps; PostgreSQL startup no
  longer initializes or mentions SQLite.
- **v1.0 GA** — immutable v1.0.0 through v1.0.8 tags, explicit upgrade/rollback
  policy, and best-effort latest-patch support.
- **Onboarding and estate scoping** — connect GitHub or GitLab, store credentials
  server-side, and select monitored organizations, groups, and repositories.
- **Grow the estate** — add organizations or groups to an existing connection
  and review repositories discovered since the last acknowledgement.
- **Sign-out and version visibility** — end sessions from the UI and see the
  deployed version in the sidebar, About page, and health/auth APIs.
- **GitLab discovery repair** — connect, group selection, and manual sync all
  enqueue GitLab discovery correctly.
- **Wrangler Labs release** — full project history, documentation, demo, legal
  ownership, and governance moved under Wrangler Labs.

### Platform foundations

| Area | Shipped capability |
|---|---|
| Storage | SQLite/D1 and PostgreSQL through the shared persistence seam |
| Hosting | Cloudflare Worker and Node/Hono server with self-served SPA and Docker packaging |
| Scheduling | Cloudflare Cron, Node timer, and guarded external tick driver |
| Secrets | Environment, mounted files, Azure Key Vault, and composite resolution |
| Authentication | GitHub, GitLab, Microsoft Entra ID, Google, and local development providers behind one registry |
| Deployment | Cloudflare, Docker, GitHub Pages, Azure SWA, Azure Container Apps, Kubernetes manifests, and Helm |
| Documentation | VitePress site with deployment, architecture, API, configuration, operations, security, and developer guides |

### Product phases delivered

1. **Foundation and governance** — public project, CI/CodeQL, demo mode, and
   host-agnostic frontend.
2. **GitHub estate MVP** — discovery, inventory, Command Center, workflow/PR
   state, and connection health.
3. **Branch and change intelligence** — estate-wide branches, change requests,
   comparison semantics, and exclusions.
4. **Governance, security, budgets, and usage** — hygiene checks, security-alert
   reconciliation, budget sync, estate views, and JSON export.
5. **GitLab provider** — group/subgroup discovery, pipelines, merge requests,
   branch comparison, optional webhooks, and unified estate views.

---

RepoWrangler is **platform-neutral** ([ADR-013](https://wranglerlabs.org/design/platform-neutrality)):
no cloud, host, database, or deployment model is required. Cloudflare is the
reference implementation, not a product dependency.
