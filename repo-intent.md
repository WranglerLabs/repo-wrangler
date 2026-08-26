# Repo intent — repo-wrangler

**Wrangle every repository into one clear view — the OSS RepoWrangler product.**

## What this repo is

RepoWrangler is an open-source repository-estate dashboard. It automatically
discovers repositories across GitHub organizations and GitLab groups, continuously
evaluates their operational health, and puts what needs attention on one screen:
failing pipelines, blocked and stale pull requests, branches ahead of `main` with no
PR, security findings, new and disappeared repositories.

**Deploy anywhere. Own your data.** Platform-neutral by design — the same app runs
on a laptop, self-hosted Docker, Kubernetes, Azure, or Cloudflare; infrastructure is
a swappable adapter, not a requirement. A single Cloudflare Worker + D1 on the free
tier is the *reference* deployment, not a dependency. **Read-only toward your
providers by design.**

## Shape

- `apps/`, `packages/` — the pnpm-workspace monorepo
- `deploy/` — deployment recipes across supported platforms
- `migrations/` — D1/database schema
- Extensive governance docs at root: `GOVERNANCE.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `CREDITS.md`, `THIRD_PARTY_NOTICES.md` — a mature
  open-source project, not a scaffold

## How it relates to other repos

- **`repo-wrangler.dev`** — a full fork of this repo, sole owner of the public demo
  deployment; tracks this repo's releases
- **`repo-wrangler-org`** — the marketing/docs site, built independently of this repo
- **`ranch-hand`** — the standalone Windows lifecycle/installer for this product

## Status

Active — this is the canonical open-source product repository.
