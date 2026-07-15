# ADR-011 — Host-agnostic frontend and two deployment topologies

- **Status:** Accepted
- **Date:** 2026-07-12
- **Supersedes / relates to:** ADR-001 (Cloudflare Workers as the full-stack runtime),
  SPIKE-014 (keep domain/provider packages Cloudflare-free)

> **Terminology update (2026-07-15).** This ADR named the topologies **Mode A**
> (Integrated) and **Mode B** (Decoupled); a later self-hosted topology was
> called **Mode C**. The `Mode A/B/C` letters have since been dropped in favor of
> the names — **Integrated / Decoupled / Self-hosted** — so they don't collide
> with the deployment **cost tiers** (Tier 0–3), which now own the numbers. Tier
> and topology are orthogonal axes; see [`docs/deployment.md`](../deployment.md)
> and [`deploy/README.md`](../../deploy/README.md). The decision below is
> unchanged; only the labels are.

## Context

ADR-001 makes a single Cloudflare Worker the reference runtime: it serves the
React SPA static assets *and* the Hono API *and* binds D1. That is the cheapest,
simplest, zero-config path and it stays the default.

However, a hard product requirement is that **the frontend must not be locked to
Cloudflare**. Deployers must be able to host the UI on GitHub Pages, Azure Static
Web Apps, Cloudflare Pages, or any static file host, while still pointing at a
Worker API. The SPA is already a pure static Vite bundle, but two things tie it
to same-origin Cloudflare hosting today:

1. The web client calls the API with **relative paths** (`fetch('/api/v1/...')`),
   which only works when the SPA is served from the same origin as the Worker.
2. The Worker has **no CORS allowlist**, so a browser on a different origin
   (`https://<user>.github.io`) would be blocked from calling the API.

Backend portability (running the API on Node/Postgres instead of Workers) is a
separate, later concern; it is kept *possible* by the `persistence-core`
interface and Cloudflare-free domain/provider packages, but is **not** delivered
here. This ADR delivers **frontend** portability now.

## Decision

Support **two topologies** from one codebase, selected purely by configuration —
no code fork:

### Mode A — Integrated (default, zero-config, zero-cost)

One Cloudflare Worker serves the SPA assets and the API + D1. `VITE_API_BASE_URL`
is empty, so the SPA uses same-origin relative requests. No CORS needed. This is
the documented default and the path the free-tier promise rests on.

### Mode B — Decoupled frontend

The SPA is built as a plain static bundle and deployed to any static host,
configured at **build time** with `VITE_API_BASE_URL=https://<your-worker-host>`.
The Worker enables a **CORS allowlist** (`CORS_ALLOWED_ORIGINS`, comma-separated)
so only the operator's chosen SPA origin(s) may call the API with credentials.

To make this real:

- The web client reads its API base from `import.meta.env.VITE_API_BASE_URL` and
  prefixes every request with it (empty string ⇒ same-origin, preserving Mode A).
  The SPA continues to import **no** Worker or Cloudflare types.
- The Worker applies CORS on `/api/*` from `CORS_ALLOWED_ORIGINS`; when the var is
  empty (Mode A) no cross-origin access is granted, which is the safe default.
- `deploy/` ships one recipe + CI workflow per supported host:
  `deploy/cloudflare/` (Mode A), `deploy/github-pages/`, `deploy/azure-swa/`
  (Mode B). Each documents the exact `VITE_API_BASE_URL` / `CORS_ALLOWED_ORIGINS`
  pairing and any base-path handling (GitHub Pages project sites need
  `VITE_BASE_PATH`).

## Consequences

**Positive**
- Deployers are not locked into Cloudflare for the UI; the free, zero-config
  integrated Worker remains the default and the recommended first deploy.
- Security posture is explicit: cross-origin API access requires an operator to
  opt in by naming allowed origins; the default grants none.
- No divergent builds — the same SPA artifact serves both modes; only env vars
  differ.

**Negative / cost**
- Mode B is a two-piece deployment (static host + Worker) with a CORS
  contract the operator must keep in sync; more moving parts than Mode A.
- `VITE_API_BASE_URL` is baked at build time, so changing the API host means a
  rebuild of the static bundle (acceptable — it is deploy-time config).

**Neutral**
- Backend portability (Node/Postgres) remains a roadmap item (Phase 6); this ADR
  does not deliver or block it. The Cloudflare-free package boundary that would
  enable it is unaffected.
