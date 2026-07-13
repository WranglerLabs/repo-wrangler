# ADR-018: Scheduler drivers (external-tick)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Relates to:** [ADR-013 (platform-neutral architecture)](ADR-013-platform-neutral-architecture.md),
  [ADR-014 (Node server host)](ADR-014-node-server-host.md)

## Context

RepoWrangler's periodic sync and daily maintenance run from a scheduler. Two
concrete drivers already existed: **Cloudflare Cron** (wrangler triggers call the
Worker's `scheduled` handler) and an **in-process timer** on the Node host. But
ADR-013 lists many scheduling environments — Linux `cron`, Kubernetes `CronJob`,
GitHub Actions schedules, Azure Functions timers — and the in-process timer is a
poor fit for a horizontally-scaled deployment, where every replica would fire its
own copy. Scheduling had to become swappable (PN-3) without duplicating the sync
logic per environment.

## Decision

Keep the single work function (`runScheduled(env, cron)`) and make the *trigger*
pluggable via `SCHEDULER_MODE` on the Node host:

- **`in-process`** (default) — the internal minute-tick timer, matching the two
  Cloudflare cron expressions. Ideal for a single container.
- **`external`** — no in-process timer. An outside scheduler drives work by
  POSTing **`/internal/cron/run`** (`?job=periodic|daily`), authenticated with a
  shared bearer token (`CRON_TRIGGER_TOKEN`). Linux cron, a Kubernetes `CronJob`,
  a GitHub Actions schedule, and an Azure Functions timer are all just this one
  HTTP call on a schedule — every "driver" collapses into one interface.
- **`off`** — no scheduling (e.g. a stateless read replica).

The endpoint is inert unless `SCHEDULER_MODE=external` **and** `CRON_TRIGGER_TOKEN`
is set, so a default deployment never exposes a triggerable sync path. The token
is compared in constant time; the token itself is a secret resolved through the
ADR-017 provider seam.

## Consequences

- **Positive:** multi-replica hosts run one external ticker (a CronJob) hitting a
  load-balanced endpoint instead of N racing in-process timers; single-container
  hosts keep the zero-config in-process timer. Full PN-3 coverage with one small
  endpoint rather than one bespoke driver per platform.
- **Security:** the trigger is gated by mode + bearer token; absent either, it
  returns 404 and does nothing.
- **Cloudflare unaffected:** cron triggers still call the `scheduled` handler;
  `SCHEDULER_MODE` is a Node-host concern.
- **Verification:** unit tests assert 404 (not external / no token), 401
  (missing/wrong token), and 200 with job selection; a live boot with
  `SCHEDULER_MODE=external` rejects a wrong token and runs the periodic job with
  the right one.
