# Tier 0 — Free / self-run

**Cost: $0.** For trying RepoWrangler out, running a home lab, or hosting it on
hardware you already own. Nothing to pay, nothing to provision — you can be on
real data with just a GitHub App.

Tier 0 is where most people start, and many stay. It covers every recipe that
costs nothing out of pocket. Pick by **who owns the box** and **how the pieces
are wired** (see [topologies](../deployment#topology)):

## Recipes

| Recipe | Topology | Where it runs | Backend |
|---|---|---|---|
| [`cloudflare`](../../deploy/cloudflare/) | Integrated | Cloudflare's edge (free tier) | D1 |
| [`docker`](../../deploy/docker/) | Self-hosted | Your laptop, home server, or a VM | SQLite |
| [`github-pages`](../../deploy/github-pages/) | Decoupled | UI on GitHub Pages + a Worker API | D1 |
| [`azure-swa`](../../deploy/azure-swa/) | Decoupled | UI on Azure Static Web Apps + a Worker API | D1 |

## Which one?

- **Want zero ops?** [`cloudflare`](../../deploy/cloudflare/) — one Worker serves
  the whole app on the free tier. No machine to keep alive, no OS to patch. The
  reference deployment and the fastest path to a public URL.
- **Want it on your own hardware / offline?** [`docker`](../../deploy/docker/) —
  `docker compose up` runs the entire product (SPA + API + scheduler) in one
  container on SQLite. Runs air-gapped; no Cloudflare account needed.
- **Already have a static site host?** [`github-pages`](../../deploy/github-pages/)
  or [`azure-swa`](../../deploy/azure-swa/) put the UI on a host you already use
  and keep the API on a free Worker. Still $0, but you maintain a CORS contract
  between the two origins — more moving parts for the same cost.

## Cost reality

Everything here fits inside a free tier or your own compute. The only spend is if
your estate grows past Cloudflare's free Worker/D1 request limits (large
estates) — at which point [Tier 1](tier-1) or a paid Cloudflare plan is the next
step. For a personal or small-team estate, Tier 0 stays free indefinitely.

## Going real

Free applies to demo **and** real mode — real mode just adds a GitHub App and six
secrets. Follow the "real mode" section in your chosen recipe, or the shared
[Going to real mode](../deployment#going-to-real-mode) steps.
