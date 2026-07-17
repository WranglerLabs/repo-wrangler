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
| **Now** | Stabilize RepoWrangler v1.0 and advance Ranch Hand Public Preview toward GA | A dependable product release with a primary guided deployment path and explicit Preview boundaries |
| **Next** | Make setup, access, and operations easier | A new operator can deploy confidently, add users, and understand sync health without editing configuration or querying the database |
| **Later** | Scale administration, security, providers, and cost visibility | RepoWrangler grows from a strong estate dashboard into a broader operations platform |

---

## Now — stabilize v1.0 GA

**Status: GA.** RepoWrangler v1.0.10 is the current supported patch release.
Ranch Hand `v0.1.0-rc.2` is now the primary recommended Windows deployment path
in **Public Preview**; the manual recipes remain a supported alternative. The
immediate focus is operator feedback, deployment safety, and the Ranch Hand GA
gates. Support is
best-effort and targets the latest patch release only.

---

## Next — ranked post-release work

Work is expected to proceed in this order. The ordering is deliberate; a new
item entering this list should displace or move an existing item.

| Priority | Initiative | Outcome | Key dependency |
|---:|---|---|---|
| 1 | **Ranch Hand GA** | Promote the primary guided deployment path from Public Preview to a signed, production-capable lifecycle manager for the latest supported RepoWrangler patch | Signing, production configuration/lifecycle parity, uninstall, upgrades, security/accessibility/real-target UAT, task-tested docs |
| 2 | **Invite and manage users** | Administrators add or remove allowed identities in the UI without editing environment variables or restarting | Provider identity model |
| 3 | **Operations and sync history** | Administration shows discovery runs, queue state, failures, duration, and repositories found—no direct database queries required | Existing sync-job data |
| 4 | **Faster enrichment after discovery** | Newly discovered repositories receive branch, PR/MR, pipeline, security, and billing data promptly instead of trickling in | Existing rate-limit and job-budget controls |
| 5 | **Budget settings audit** | Operators see organization and repository budget settings, plus a clear capability message when provider credentials cannot read them | GitHub billing API capability probe |
| 6 | **GitLab URL normalization** | Pasting a group URL safely resolves to the GitLab origin and produces accurate authentication versus connectivity errors | None |
| 7 | **Per-connection scope picker** | Operators explicitly select which visible organizations or groups a connection monitors | Existing grow-estate flow |

### Ranch Hand Public Preview → GA

[Ranch Hand](https://github.com/WranglerLabs/ranch-hand) replaces the retired
PowerShell/bash bootstrap-script concept. It is a separate Windows-first Go/React
lifecycle application, not a RepoWrangler feature screen and not a source-clone
script. It consumes the exact release manifest, digest-pinned image, target
bundle, SBOM, and provenance published by RepoWrangler.

The public `v0.1.0-rc.2` Preview discovers the latest compatible stable
RepoWrangler release by default, verifies it, and installs all four
initial target families; local Docker also has backup-first lifecycle and
recovery operations. It is now the primary recommended Windows deployment path,
while clone/fork/manual/custom-CI remains supported.

GA requires: approved Authenticode signing and a stable channel; compatibility
with the latest supported RepoWrangler patch; guided production credentials,
authentication, database, storage, domain, and HTTPS configuration; integrated
Azure sign-in; complete ownership-safe backup/update/restore/rollback/repair and
uninstall/data-retention behavior for each GA target; Ranch Hand application and
state upgrade compatibility; clean-Windows and disposable real-target UAT;
keyboard/screen-reader/zoom/forced-colors/high-DPI testing; privileged-adapter,
least-privilege, tamper, downgrade, redaction, and dependency security gates;
and task-tested public documentation with the latest-version best-effort support
matrix. A target remains Preview until its own complete production lifecycle and
real-target tests pass.

---

## Later — directional investments

### Security, deployment, and scale

| Initiative | Intended outcome |
|---|---|
| **Credentials & Access** | Inventory every configured credential without exposing its value; verify live reach and flag failing, unused, or over-scoped access |
| Multiple connections per provider | Support separate Apps, tokens, organizations, groups, and health state for each connection |
| Tier 3 architecture | Compose the existing platform-neutral foundations into a hardened enterprise topology with private networking, HA data, observability, SSO, and RBAC |
| Deployment automation and pipelines | Ship opt-in GitHub Actions and Azure DevOps templates that consume the same versioned deployment-plan contract as Ranch Hand |

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

- Ranch Hand and future deployment pipelines consume the same versioned,
  secret-free deployment-plan contract.
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
- **v1.0 GA** — immutable v1.0.0 through v1.0.10 tags, explicit upgrade/rollback
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
