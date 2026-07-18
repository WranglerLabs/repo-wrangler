# TODO

Owner-directed priorities. Larger design work referenced here lives in
[the design pack](https://wranglerlabs.org/design/design-pack-index) and the [roadmap](ROADMAP.md).

## 1. Ranch Hand Public Preview → GA

Ranch Hand is the separate, clone-free Windows deployment and lifecycle manager.
The public `v0.1.0-rc.5` Preview is the primary recommended Windows deployment
path. It consumes immutable RepoWrangler artifacts,
creates secret-free plans, runs preflight/dry run, and supports bounded installs
for local WSL Compose, local Docker Desktop, remote Linux Compose, Cloudflare,
and Azure Container Apps.

Remaining work: Authenticode signing/stable channel; latest-patch compatibility;
integrated Azure authentication; guided production configuration; complete
target backup/update/restore/rollback/repair/uninstall and retention contracts;
Ranch Hand state/application upgrades; clean-Windows, accessibility, security,
and real-target UAT; task-tested documentation; and an explicit GA support
matrix. Manual clone/fork/custom-CI remains supported.

## 2. Architecture tiers — classify every deployment option

Reframe the deployment story as **three named tiers**, so a deployer picks a tier
first, then a recipe inside it:

- **Tier A — All-in-one (simple).** Everything in a single container (app +
  embedded DB) or one compose stack. Runs anywhere a container runs: Docker
  Desktop, docker compose, a small VM, Azure Container Apps/Instances, a home
  lab. One command, minimal decisions, cheapest possible.
- **Tier B — Mid-level (still cheap, a few more moving parts).** Managed edges +
  inexpensive managed data: Cloudflare Pages/Worker + D1, Azure Static Web Apps +
  a low-cost database tier, container host + managed PostgreSQL. Larger scale
  than Tier A while keeping cost near-zero; a handful of services instead of one.
- **Tier C — Enterprise (roadmap).** Beyond a single admin: scaled-out,
  multi-replica with separated controllers/workers, VNet/private networking,
  HA database, observability/alerting, IaC-first, SSO/RBAC hardening. Design and
  document as a roadmap phase — not required for Tiers A/B users.

Work items: map every existing `deploy/*` recipe into a tier, restructure
[deployment documentation](https://wranglerlabs.org/deployment) (picker, capability matrix, decision
flowchart) around the tiers, and present the same tier/target language in Ranch
Hand and the manual recipes.

## 3. Multiple connections per provider (multi-org, multi-credential)

Today each provider effectively has **one** connection (one GitHub App, one GitLab
token). Real estates aren't that tidy: different orgs may require **different
credentials** — separate GitHub Apps per org, multiple GitLab tokens across
groups/instances. Work items: N `provider_connections` per provider type, each
with its own credentials (the encrypted store already keys secrets per
connection), its own workspace scope, and independent health; the wizard/estate
screens gain "Add another GitHub/GitLab connection"; sync iterates connections
instead of assuming one.

## 4. Credentials & Access security screen

One place that inventories **every credential the instance holds** — GitHub Apps,
GitLab tokens (ADO/Bitbucket when those providers land) — and shows for each:
what it is, **its actual granted permissions pulled live from the provider**
(GitHub App permission set + installations; GitLab token scopes), **where it's
applied** (orgs/groups/repos), age/last-used, and a **read-only verification
badge** — flagging loudly if any credential holds write scopes the product never
needs. This is both a trust feature ("prove to me it's read-only") and an ops
feature (rotation targets in one view).

## 5. Deployment automation & pipelines (shipped in-repo, not active)

Provide ready-to-use **pipeline/automation definitions** in the repo — inert
until a deployer adopts them: GitHub Actions workflows, Azure DevOps pipelines,
and plain scripts per tier/recipe. Ranch Hand already exports the canonical,
secret-free deployment plan for review or user-owned automation. Future pipeline
templates consume that same versioned contract; the RC does not trigger external
CI directly or expose its authenticated loopback API as an unattended runner.
