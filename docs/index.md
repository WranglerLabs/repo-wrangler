---
layout: home

hero:
  name: RepoWrangler
  text: Your repository estate, under control.
  tagline: >-
    Open-source, read-only command center for your GitHub and GitLab estate.
    Platform-neutral, self-hostable anywhere, zero-cost to start — and it never
    writes to your repos.
  actions:
    - theme: brand
      text: Try the live demo
      link: https://repowrangler.dev
    - theme: alt
      text: Get started
      link: /getting-started
    - theme: alt
      text: Deploy it
      link: /deployment
    - theme: alt
      text: View on GitHub
      link: https://github.com/WranglerLabs/repo-wrangler

features:
  - icon: 🔭
    title: See the whole estate
    details: >-
      Automatic discovery of every repository across your GitHub and GitLab
      accounts, with branch, PR/MR, pipeline, security, and budget health in one
      Command Center.
  - icon: 🔒
    title: Read-only by design
    details: >-
      No write scopes, no write actions. The worst case for a compromised
      instance is disclosure of metadata it already stores — never a change to
      your repositories.
  - icon: 🧭
    title: Platform-neutral
    details: >-
      Run it on Cloudflare, a self-hosted container, Azure Container Apps, or
      Kubernetes — on SQLite or PostgreSQL. Cloudflare is the reference, not a
      requirement.
  - icon: 🚀
    title: Zero-cost demo, no secrets
    details: >-
      Every deployment starts in demo mode with mock data. One command —
      docker compose up — and you are exploring the whole product.
  - icon: 🔑
    title: Sign in your way
    details: >-
      GitHub user-authorization or Microsoft Entra ID (OIDC). An allowlist gates
      access; the first person in becomes the owner.
  - icon: 📈
    title: Scales when you do
    details: >-
      Start on a single SQLite container; switch to PostgreSQL for multiple API
      replicas behind a load balancer — same image, one setting.
---

## Where to next

- **Want to see it first?** Explore the
  [**live demo**](https://repowrangler.dev) — the
  whole product on mock data, no sign-in, no secrets.
- **New here?** Start with [Getting started](/getting-started) — a running
  instance in a few minutes.
- **Choosing where to run it?** The [deployment guide](/deployment) has a
  capability matrix and a decision flowchart.
- **Connecting a provider?** [GitHub App](/providers/github-app) ·
  [GitLab](/providers/gitlab) · [Entra ID sign-in](/providers/entra).
- **Going deeper?** [Architecture](/architecture) · [API reference](/api) ·
  [Configuration](/configuration).
- **Running it for real?** [Operations](/operations) · [Security](/security) ·
  [Troubleshooting](/troubleshooting).
