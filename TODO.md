# TODO

Owner-directed priorities. Larger design work referenced here lives in
[`docs/design/`](docs/design/) and the [roadmap](ROADMAP.md).

## 1. Guided bootstrap installer ("the bootloader")

A one-command bootstrap that copies a **small set of installer files** locally and
opens a **local React wizard**: pick how the infrastructure will be deployed →
answer **exactly the inputs that choice needs** (with naming presets, e.g. CAF) →
the back end **kicks off the deployment while the same page streams live status**.
Ships with **PowerShell and bash** launchers. See the platform PMO task for the
full spec; pairs with item 3 below for the execution layer.

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
[`docs/deployment.md`](docs/deployment.md) (picker, capability matrix, decision
flowchart) around the tiers, and make the bootstrap installer's first question
"which tier?".

## 3. Deployment automation & pipelines (shipped in-repo, not active)

Provide ready-to-use **pipeline/automation definitions** in the repo — inert
until a deployer adopts them: GitHub Actions workflows, Azure DevOps pipelines,
and plain scripts per tier/recipe. The **bootstrap installer (item 1) is the
front door**: after the wizard collects choices + inputs it either
(a) **kicks off the automation directly**, or (b) **emits a config JSON** the
deployer feeds to their own tooling (the pipelines here consume the same JSON).
One config schema shared by the wizard, the pipelines, and the docs.
