# Releases

Every RepoWrangler release, newest first — version, build, and what shipped.
Use this page to answer one question fast: **is my instance behind?**

## Find your instance's version

- **UI:** the version under the RepoWrangler logo in the sidebar (e.g. `v0.6.10`),
  also shown on **About & Credits** and **Platform Health**.
- **API:** `GET /auth/config` or `GET /health/live` → `"version"`.

If your version is older than the newest release below, see
[Updating your instance](/updating).

## Release history

| Version | Date | Git tag | Server image | Highlights |
|---|---|---|---|---|
| [0.6.10](/releases/v0.6.10) | 2026-07-14 | `v0.6.10` | `repo-wrangler-server:v0.6.10` | First release under Wrangler Labs — sign-out, GitLab discovery fix, estate growth, WranglerLabs rebrand, version wiring |
| 0.5.0 | 2026-07-13 | `v0.5.0` | `repo-wrangler-server:v0.5.0` | More secret providers (Cloudflare KV), deployment hardening |
| 0.4.0 | 2026-07-13 | `v0.4.0` | — | Platform-neutral deploy recipes, provider capability matrix |
| 0.3.0 | 2026-07-12 | `v0.3.0` | — | First tagged release: dashboard core, GitHub/GitLab adapters, demo mode |

::: info The 0.6.x release-candidate series
Between 0.5.0 and 0.6.10, nineteen days of live hardening shipped as
`v0.5.1-rc1` … `v0.6.10-rc1` release-candidate images (onboarding wizard,
first-boot setup, connection secrets, estate scope). Those rc builds were
deployment iterations, not releases; their changes are consolidated into the
[0.6.10 notes](/releases/v0.6.10) and the [changelog](/project/changelog).
:::

## Where releases run

| Environment | URL | Tracks |
|---|---|---|
| Public demo (synthetic data) | [repowrangler.dev](https://repowrangler.dev) | Latest release tag (auto-deploys on tag) |
| Your instance | — | Whatever you deploy — check the sidebar version |
