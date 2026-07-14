# RepoWrangler Design — Repository Onboarding & Estate Scope

**Status:** Proposed — awaiting owner review
**Prepared:** 2026-07-14

> Authoritative design for how an operator, after deploying RepoWrangler, connects a
> platform — **entering or one-tap-creating the provider credentials in the wizard
> itself**, not pre-seeding a vault out of band — discovers their organizations and
> repositories, and chooses which of them the product monitors, plus how repositories
> and credentials are managed later and how newly created repos are surfaced for review.
> This amends the [solution design](RepoWrangler-Solution-Design.md) and is governed by
> the [platform-neutrality addendum](platform-neutrality.md)
> ([ADR-013](../adr/ADR-013-platform-neutral-architecture.md)). It proposes two new
> decision records: **ADR-020 — Estate scope and monitoring state** and **ADR-021 —
> Runtime-entered provider credentials**.

## The gap

A fresh deployment has no path, inside the product, from "it is running" to "it is
watching the repositories I care about." Providers are configured only through
environment variables and secrets (`apps/worker/src/bindings.ts`); there is no screen
that lets a user pick a platform, connect it, search their orgs or groups, and choose
repositories. There is also no ongoing control: once discovery has run, an operator
cannot narrow the estate, cannot add a newly relevant group, and has no view of
repositories that appeared after the initial pass. The only runtime control today is
`POST /api/v1/admin/sync` (`apps/worker/src/api/routes.ts:489`), a global
re-discovery with no scoping.

The building blocks for the *scoping* half already exist and are partly wired:

- Both `workspaces` and `repositories` carry `monitoring_state TEXT NOT NULL DEFAULT 'monitored'`
  (`migrations/0001_initial.sql:32` and `:63`), and there is an index on it
  (`idx_repositories_enrich`, `:77`).
- It is already **enforced** in the two hot paths: enrichment
  (`claimEnrichmentBatch`, `packages/persistence-d1/src/repositories.ts:178`) and the
  sync-eligibility query (`listWorkspacesForSync`, `packages/persistence-d1/src/workspaces.ts:86`).
- The upsert paths already **preserve** it: neither `upsertWorkspace`
  (`workspaces.ts:16`) nor `upsertRepository` (`repositories.ts:25`) writes
  `monitoring_state` on the UPDATE branch, so a value an operator set is never
  clobbered by a later discovery pass.
- `provider_connections` has an unused `secret_reference` column
  (`migrations/0001_initial.sql:13`) — the intended home for a Phase B secret pointer.

What is missing is (1) anything that ever writes a non-default value, (2) enforcement
in the estate-facing read queries and in discovery's org-level loop, (3) any UI, and
(4) a way to **enter provider credentials at runtime** — the secret seam today is
read-only and boot-pinned. This design closes all four in three phases. Phase A needs
no schema change; Phase B adds exactly one table (the encrypted credential store the
runtime-entry requirement makes unavoidable); Phase C adds none.

## Goals

- After deploying in real mode, a first-run user is guided to connect a platform,
  see their orgs/groups and repositories, and choose what to monitor — without
  editing environment variables or handing secrets to a setup session by hand.
- **Provider credentials are entered (or one-tap-created) in the wizard itself** and
  the product persists them; the operator never pre-seeds a vault out of band. Runtime
  entry is live without a manual restart, and credentials are rotatable later.
- An operator can change the monitored set at any time from a permanent admin screen.
- Newly created repositories are discovered automatically (the scheduled pass already
  does this) and surfaced for review rather than silently appearing or silently hidden.
- Every mutation is admin-only. No secret value ever reaches the browser.
- Phase A ships as a backend-only increment with zero schema change and no UI, and is
  safe on existing deployments (filters are no-ops until something is marked ignored).

## Non-goals

- No provider **write** actions — consistent with [ADR-008](../adr/README.md). Onboarding
  reads and monitors; it never creates, forks, or modifies upstream repositories.
- No multi-tenant model. This remains single-tenant per [ADR-010](../adr/README.md); the
  wizard configures *this* deployment's estate, not per-user views.
- No new authentication provider. Sign-in continues to use the registry from
  [ADR-019](../adr/ADR-019-authentication-provider-registry.md); onboarding is about
  *repository provider connections*, which are distinct from sign-in providers.
- Phase B does not replace the existing env-var configuration path; it supplements it.
  A GitOps operator who prefers `GITHUB_APP_ID` / `GITLAB_GROUPS` in config keeps that
  path working.

---

## Concepts — connection, workspace, monitoring state

RepoWrangler's provider-neutral core ([ADR-004](../adr/README.md)) already models the
hierarchy this design needs:

```text
provider_connection   (a connected GitHub App, or a GitLab token + base URL)
  └── workspace        (a GitHub org/user installation target, or a GitLab group)
        └── repository  (a repo/project)
```

**Monitoring state** is a property of a workspace *and* of a repository. It is the
single lever this design turns:

| Value        | Meaning                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| `monitored`  | Default. Discovery scans it; it counts in the estate; enrichment and health run against it. |
| `ignored`    | Kept in the inventory (still discoverable, still visible on the management screen) but excluded from the estate views, from enrichment, and — for a workspace — from per-repo pagination during discovery. |
| `pending`    | *(Phase C, optional)* Discovered but awaiting an operator's review decision. Weighed below. |

A workspace's state is the coarse control (ignore a whole org/group); a repository's
state is the fine control (ignore one repo inside a monitored org). A repository is
part of the live estate only when **both** its own state and its workspace's state are
`monitored`.

---

## Phase A — backend MVP (zero schema change)

Everything here is server-side and independently shippable. It gives the eventual UI
its API and makes monitoring state actually govern the product.

### A1 — Admin write API

Two mutating endpoints, both under the existing `/api/v1` router, both `requireAdmin`
(`apps/worker/src/middleware/auth.ts:33`), both rejected in demo mode:

```
PATCH /api/v1/workspaces/:id
  auth: requireAdmin
  body: { "monitoring_state": "monitored" | "ignored" }
  200:  { "id": "...", "monitoring_state": "ignored" }
  400:  invalid state value
  403:  not admin/owner
  404:  no such workspace
  409:  demo mode (nothing to mutate)

PATCH /api/v1/repositories/:id
  auth: requireAdmin
  body: { "monitoring_state": "monitored" | "ignored" }
  (responses as above)
```

Backed by two new persistence helpers alongside the existing setters in
`packages/persistence-d1`:

- `setWorkspaceMonitoringState(db, id, state)` in `workspaces.ts`
- `setRepositoryMonitoringState(db, id, state)` in `repositories.ts`

Both validate `state ∈ {monitored, ignored}` at the route boundary (reject anything
else with 400) and write `updated_at`/`last_seen_at` untouched — this is an operator
decision, not a discovery event. Each mutation writes an `audit_events` row via the
existing `recordAuditEvent` (as `POST /admin/sync` already does at `routes.ts:493`),
e.g. `estate.workspace.ignore` / `estate.repository.monitor`.

### A2 — Discovery respects state (org-level skip)

The per-repo upsert already preserves state, so no change is needed there. The change
is at the **workspace loop**, so an ignored org/group does not consume API budget
paginating repositories we will never show:

- **GitHub** (`apps/worker/src/scheduled/index.ts:217`–`258`): the loop upserts the
  workspace, then fetches an installation token and paginates repositories. Insert the
  skip **after** `upsertWorkspace` and **before** `getInstallationToken`: read the
  workspace's `monitoring_state`; if `ignored`, `continue`. The upsert still runs
  (free — we already hold the installation object) so an ignored org stays current and
  visible on the management screen, but we spend zero subrequests scanning it. This
  matters directly under the Workers 50-subrequest / 10 ms budget.
- **GitLab** (`apps/scheduled/index.ts:283`–`301`): same shape — after
  `upsertWorkspace`, before `listGroupProjects`, skip if `ignored`.

Both loops need the workspace's current state after upsert. `upsertWorkspace` returns
only the id today; add a lightweight `getWorkspaceMonitoringState(db, id)` read (or
have `upsertWorkspace` return `{ id, monitoringState }`). Prefer the small read to keep
the upsert signature stable.

> Note: `listWorkspacesForSync` (`workspaces.ts:86`) already filters to
> `monitoring_state = 'monitored'`, so the **enrichment/health** scheduled pass is
> already scoped. The skip above closes the remaining **discovery** pass.

### A3 — Estate read queries filter to monitored

Two queries currently ignore monitoring state and must respect it:

- `listRepositoryItems` (`repositories.ts:232`, `WHERE` at `:262`): add
  `AND r.monitoring_state = 'monitored' AND w.monitoring_state = 'monitored'` (the
  `workspaces w` join is already present at `:259`). Add an
  `includeIgnored?: boolean` option — the management screen (Phase B) sets it to list
  everything with its state; the estate table leaves it false.
- `getOverviewCounts` (`repositories.ts:282`): the `workspaces`, `repositories`,
  `failing`, and `new7d` sub-counts must exclude ignored rows. Because these are
  correlated subqueries over `repositories` without the workspace join, add
  `AND monitoring_state = 'monitored'` to each repository sub-count and, for the
  workspace count, `AND monitoring_state = 'monitored'`. For repo counts that should
  also honor an ignored *workspace*, filter to
  `workspace_id IN (SELECT id FROM workspaces WHERE monitoring_state = 'monitored')`.

### A4 — Safety on existing deployments

Every deployment today has every row at the `monitored` default, so all Phase A
filters are no-ops until an operator marks something ignored. There is no migration and
no behavioral change on upgrade. This is the property that makes Phase A shippable on
its own, ahead of any UI.

### Phase A test plan

- Unit: `setWorkspaceMonitoringState` / `setRepositoryMonitoringState` round-trip;
  invalid state rejected at the route (400).
- Unit: `listRepositoryItems` excludes an ignored repo and every repo under an ignored
  workspace; `includeIgnored` returns them with state attached.
- Unit: `getOverviewCounts` drops ignored repos/workspaces from all sub-counts.
- Discovery: an ignored workspace is upserted but its repositories are **not**
  paginated (assert the provider client's list call is not invoked).
- Auth: `PATCH` returns 403 for a viewer session, 200 for admin/owner, 409 in demo.
- Regression: a default deployment (nothing ignored) returns the same estate and counts
  as before.

---

## Phase B — onboarding wizard & estate-scope management

Phase B adds the two UI surfaces and the connect API behind them. It reuses Phase A's
`PATCH` endpoints and the same components for both the first-run wizard and the
permanent management screen.

### B1 — First-run detection

Show the wizard when the deployment is in **real mode** and has **no monitored
estate yet**. Real mode is already computed by `isDemoMode` (`bindings.ts:118`) — it is
demo only when `DEMO_MODE` is unset/true *and* no provider is configured. Add a small
status endpoint the SPA calls on load:

```
GET /api/v1/onboarding/status        (requireAuth)
  200: {
    "demo": false,
    "connections": 0,          // provider_connections count
    "monitoredWorkspaces": 0,  // workspaces with monitoring_state='monitored'
    "firstRun": true           // real mode AND monitoredWorkspaces == 0
  }
```

`firstRun` drives a redirect to `/onboarding`. Once at least one workspace is
monitored, the wizard is no longer forced; it remains reachable from Administration.

### B2 — Wizard flow (text sketch)

```
Step 1 — Pick platform(s)
  [ GitHub ]   [ GitLab ]           (multi-select; each is an independent connection)

Step 2 — Connect
  GitHub  → "Create the RepoWrangler GitHub App" (reuses GET /setup/github-app,
            the one-tap manifest flow in apps/worker/src/setup/manifest.ts)
          → app created → code exchanged automatically (see B3, no copy/paste)
          → "Install the app" → choose org(s), All repositories
  GitLab  → base URL (default gitlab.com) + personal/group access token
          → server validates the token, stores it, creates the connection

Step 3 — Choose what to monitor
  Discovery runs for the new connection.
  ┌──────────────────────────────────────────────────────────────┐
  │ Search: [ platform____ ]        [ Select all ] [ Select none ] │
  │  ▸ acme-labs         (group, 42 repos)              [x] monitor │
  │     ├ acme-labs/api                                 [x]         │
  │     ├ acme-labs/web                                 [x]         │
  │     └ acme-labs/legacy-thing                        [ ] ignore  │
  │  ▸ personal-sandbox  (user, 7 repos)                [ ] ignore  │
  └──────────────────────────────────────────────────────────────┘
  Toggling a workspace off ignores the whole org/group; per-repo toggles override.

Step 4 — Finish
  Summary of monitored orgs/groups and repo count → [ Go to Command Center ]
```

Step 3's toggles are exactly the Phase A `PATCH /workspaces/:id` and
`PATCH /repositories/:id` calls, over the `includeIgnored=true` listing from A3.

### B3 — Connect API

```
POST /api/v1/connections/github/exchange      (requireAdmin, not demo)
  body: { "code": "<one-time manifest code>" }
  action: server calls GitHub POST /app-manifests/{code}/conversions, receives the
          app id, private key (PEM), webhook secret, and OAuth client id/secret;
          persists each through the WRITABLE secret backend and inserts a
          provider_connections row whose secret_reference points to the stored
          secret set. See "Credential entry" below — this is the runtime-write path.
  200: { "connectionId": "...", "appSlug": "repowrangler-...", "installUrl": "https://github.com/apps/<slug>/installations/new" }

POST /api/v1/connections/github/credentials   (requireAdmin, not demo)
  body: { "appId","privateKey","webhookSecret","clientId?","clientSecret?" }
  action: for operators who already have a GitHub App and would rather PASTE its
          credentials than create a new one via the manifest flow. Same persistence
          and provider_connections row as the exchange path. See "Credential entry".
  200: { "connectionId": "..." }

GET  /api/v1/connections/:id/workspaces        (requireAdmin)
  200: [ { "id","slug","kind","monitoring_state","repoCount" }, ... ]
       — discovered installations/groups for the connect step's toggle list.

POST /api/v1/connections/gitlab                (requireAdmin, not demo)
  body: { "baseUrl": "https://gitlab.com", "token": "<PAT>" }
  action: validate token (GitLab GET /user); persist token through the writable
          secret backend; insert provider_connections row (secret_reference →
          stored token). See "Credential entry".
  200: { "connectionId": "..." }
  401 upstream → 400 { "error": "token rejected by GitLab" }

GET  /api/v1/connections/:id/search-groups?q=  (requireAdmin)
  action: server-side proxy to GitLab Groups API using the connection's stored token;
          the token never leaves the server.
  200: [ { "externalId","fullPath","name","projectCount" }, ... ]

POST /api/v1/connections/:id/workspaces        (requireAdmin, not demo)
  body: { "externalIds": ["acme-labs","acme-labs/platform"] }
  action: create workspace rows (monitoring_state='monitored') for the selected
          GitLab groups so discovery visits them.
```

The GitHub manifest flow's manual half — where `apps/worker/src/setup/manifest.ts:116`
tells the operator to hand the code to a setup session — is replaced by the
`POST /connections/github/exchange` call driven from Step 2. The manifest page itself is
reused unchanged.

### B4 — Sync-engine change for GitLab connections

Today GitLab discovery reads its group list from the `GITLAB_GROUPS` env var
(`scheduled/index.ts:276`). For a UI-selected connection, the source of truth becomes
the **workspaces table** (the rows created by `POST /connections/:id/workspaces`).
Change `runGitLabDiscovery` to: if the connection has persisted workspaces, iterate
those group paths; otherwise fall back to `GITLAB_GROUPS`. This keeps the env-var path
working for GitOps operators (a non-goal to remove it) while letting the wizard drive
selection. GitHub needs no equivalent change — its workspaces come from App
installations, and A2's skip already scopes them.

### B5 — Permanent management screen

`Administration → Estate scope` renders the **same** Step 3 component against the full
`includeIgnored=true` listing, grouped by connection. From here an operator can:
ignore/monitor any workspace or repository, add another connection (re-entering the B3
flow), and trigger a scoped re-discovery. This is the "add repos later" mechanism; it is
not a separate code path from the wizard.

### Phase B security

- Every connect and mutate endpoint is `requireAdmin`; every one 409s in demo mode.
- All provider secrets are persisted through the **writable secret backend** (see
  "Credential entry"); `provider_connections.secret_reference` holds only a **pointer**,
  never a value. Full credential-entry security posture is in that section.
- The GitLab group search and the GitHub code exchange run **server-side**; the token
  and app credentials are never returned to the browser or logged.
- No connect endpoint echoes a secret in its response. The existing CSP
  (`middleware/auth.ts:47`) already blocks external calls from the SPA, so the browser
  cannot talk to GitHub/GitLab directly even if a future bug tried to.

### Phase B test plan

- `onboarding/status` computes `firstRun` correctly across demo, real-no-workspaces,
  and real-with-workspaces.
- GitHub exchange: mocked `/app-manifests/{code}/conversions` → connection row created,
  secret stored via a fake `WritableSecretProvider`, `installUrl` returned; failure path
  surfaces a clean error and stores nothing.
- GitLab connect: valid token → connection; invalid token → 400, no row written.
- Group search proxy returns groups without leaking the token; `POST .../workspaces`
  creates monitored rows that a subsequent discovery visits.
- GitLab discovery prefers persisted workspaces over `GITLAB_GROUPS`, and falls back
  when none exist.
- All connect endpoints 403 for viewers and 409 in demo mode.

---

## Credential entry — runtime secret capture

> **First-class requirement.** Provider credentials — the GitHub App id, private key,
> webhook secret, and OAuth client id/secret; the GitLab token — must be **enterable
> through the wizard at setup time**. An operator does not pre-seed a vault out of band
> before the product will work. "Connect" *is* "enter, or one-tap-create, the
> credentials in the UI," and the product persists them itself. This is the owner's
> explicit expectation and it drives the design below.

### The tension this creates

The secret seam today ([ADR-017](../adr/ADR-017-secret-provider-seam.md),
`packages/secrets-core`) is **read-only and boot-pinned**: `SecretProvider` exposes only
`get()` (`provider.ts:19`), and the host resolves every secret **once at boot** via
`resolveSecrets` → `buildEnv`. That model is correct for *infrastructure* secrets that
exist before the process starts (`SESSION_SECRET`, the cron token). It cannot host a
credential a user types **after** the process is already running: there is nothing to
write to, and even if there were, a boot-time read would never see it without a restart.

Runtime-entered provider credentials therefore need two things the current seam lacks:
a **writable** backend, and **on-demand reads** (at point of use, not at boot).

### Two classes of secret

| Class | Examples | Lifecycle | Source |
| ----- | -------- | --------- | ------ |
| **Infrastructure secrets** | `SESSION_SECRET`, `SECRET_ENCRYPTION_KEY`, `CRON_TRIGGER_TOKEN` | Must exist **before** boot | The existing `SECRET_SOURCE` seam, resolved at boot (unchanged) |
| **Provider credentials** | GitHub App id/key/webhook/client secret, GitLab token | Entered **at runtime** via the wizard; rotatable | The **writable secret backend**, read on demand and referenced by `provider_connections.secret_reference` |

This split is the key decision: onboarding does not try to make the boot-time seam
writable. It adds a runtime store for the credentials the wizard collects, and leaves
the infrastructure path exactly as ADR-017 defined it.

### The writable backend

Add a `WritableSecretProvider` sub-interface to `secrets-core`:

```ts
export interface WritableSecretProvider extends SecretProvider {
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}
```

The **default, host-agnostic** implementation is a **database-backed store**
(`DbSecretProvider`, backend id `db`) that writes to the same `IDataStore` the app
already owns (D1 on Cloudflare; Postgres or SQLite on the Node host). It is the natural
answer to "enter it in the wizard, no vault, no restart," because the database is the
one writable store the app always has on every deployment target — unlike env vars
(immutable at runtime), Cloudflare secret bindings (writable only via the Cloudflare API
with an out-of-band token the app does not hold), and read-only mounted files.

Values are **encrypted at rest** with AES-GCM via Web Crypto, using a key derived from a
dedicated `SECRET_ENCRYPTION_KEY` (an *infrastructure* secret resolved at boot). The
database holds ciphertext + IV only; the key never lives in the database. Losing the
key is losing the provider credentials — documented as a backup obligation.

This requires **one new table** — the single justified schema addition in this whole
design (see "Data-model deltas"):

```sql
CREATE TABLE connection_secrets (
  secret_reference TEXT NOT NULL,   -- namespace, e.g. the connection id
  name             TEXT NOT NULL,   -- canonical env-name, e.g. GITHUB_APP_PRIVATE_KEY
  ciphertext       TEXT NOT NULL,   -- AES-GCM, base64
  iv               TEXT NOT NULL,
  fingerprint      TEXT,            -- non-reversible hash for the masked UI hint
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (secret_reference, name)
);
```

`provider_connections.secret_reference` (the existing unused column,
`migrations/0001_initial.sql:13`) holds the namespace pointer — never a value.

### How each SECRET_SOURCE backend behaves for wizard entry

The `db` store is layered **first** in the composite, ahead of the boot-resolved
providers, so wizard-entered credentials win and pre-seeded ones still work as a
fallback. What "persist the entered credential" means per configured backend:

| `SECRET_SOURCE` | Wizard-entered credential is… | Restart needed? |
| --------------- | ----------------------------- | --------------- |
| `env` (default) / Cloudflare bindings | written to the **`db` store** (env is immutable at runtime; Cloudflare bindings need the CF API) | **No** |
| `file` (Docker/K8s mounts) | written to the **`db` store** (mounts are read-only to the app) | **No** |
| `keyvault` / `vault` / `aws` / `gcp` | **operator's choice:** default to the **`db` store** (no vault write permission required); *or*, if the deployment grants the managed identity **write** scope, write straight into the vault via a `set()` adapter so the vault stays the system of record | **No** either way |

In every supported configuration the default path writes to the `db` store and needs no
restart, because provider credentials are **read on demand** at the point GitHub/GitLab
work happens — not hydrated at boot. The connection resolves its secrets through the
composite (`db` store first) each time a discovery or enrichment job runs, so a
credential entered in the wizard is live on the very next job with no process bounce.

### Optional: write to the configured vault

For a shop whose policy is "all secrets live in Key Vault," the wizard offers a
per-connection **"store in the configured vault"** option, available only when
`SECRET_SOURCE` is a vault backend *and* the identity has write scope. It calls the
`set()` adapter for that vault (Key Vault `PUT secret`, Vault KV write, etc.). If write
scope is absent, the UI states plainly that credentials will be stored in the encrypted
`db` store instead — it never silently fails or asks the operator to go set them by hand.

### Guided-restart fallback (only if writes are refused)

If an operator both declines the `db` store *and* has no vault write scope (a deliberate
air-gapped posture), the wizard falls back to **guided out-of-band entry**: it shows the
exact secret **names** to place (never generating or displaying values it did not
receive) and the command for their backend, then a "credentials placed — reload" action
that re-resolves and verifies the connection. This is the only path that involves a
restart, and it exists only for operators who opt out of runtime write entirely.

### Replace / rotate — ongoing management

The permanent `Administration → Estate scope` screen (B5) gains a per-connection
**Credentials** panel:

```
Connection: github · Hybrid-Solutions-Cloud App
  App private key    ••••••••1a2b   updated 2026-07-14   [ Replace ]
  Webhook secret     ••••••••set    updated 2026-07-14   [ Replace ]
  Client secret      ••••••••9f0e   updated 2026-07-14   [ Replace ]
                                                         [ Disconnect ]
```

```
PUT    /api/v1/connections/:id/credentials    (requireAdmin, not demo)
  body: { "name": "GITHUB_APP_PRIVATE_KEY", "value": "<new secret>" }
  action: set() on the writable backend for this connection's namespace; bump
          updated_at + fingerprint; write an audit row. Connection id is stable —
          rotation never re-creates the connection or loses monitoring state.
  200:   { "name": "GITHUB_APP_PRIVATE_KEY", "updatedAt": "...", "hint": "••••1a2b" }

GET    /api/v1/connections/:id/credentials    (requireAdmin)
  200:  [ { "name","present":true,"hint":"••••1a2b","updatedAt" }, ... ]
        -- presence + masked hint ONLY; never the value.

DELETE /api/v1/connections/:id                (requireAdmin, not demo)
  action: delete() every secret in the connection's namespace; mark the
          connection removed (tombstone, per the never-hard-delete convention).
```

Rotation is the same `set()` the exchange/paste paths use, so there is one write path,
not two. GitHub App key rotation can also be driven by re-running the manifest flow;
either way the new value overwrites the old in the connection's namespace.

### Security posture

- **Admin-only.** Every credential endpoint is `requireAdmin`
  (`middleware/auth.ts:33`) and 409s in demo mode. No viewer can enter, read, or rotate
  a credential.
- **Never echoed back.** `GET .../credentials` returns presence + a masked hint (a
  short non-reversible fingerprint), never the value. No endpoint returns a stored
  secret in any form.
- **Masked in transit through the UI.** Entry fields are password inputs; the value is
  POSTed once over TLS and never re-rendered. The existing CSP (`middleware/auth.ts:47`)
  keeps the browser from shipping it anywhere but this API.
- **Encrypted at rest.** `db`-store values are AES-GCM ciphertext; the key is an
  infrastructure secret outside the database.
- **Audited.** Every write/rotate/delete appends an `audit_events` row (actor, action
  e.g. `connection.credential.rotate`, connection id, secret *name*) via
  `recordAuditEvent` — **never the value**, consistent with ADR-017's "labels logged,
  values never" posture.
- **Not logged.** Values never enter logs, error messages, or the audit body.

### Credential-entry test plan

- `DbSecretProvider` round-trips `set`/`get`/`delete`; ciphertext in the row is not the
  plaintext; a wrong key fails to decrypt.
- Composite layers `db` first: a wizard-written value shadows an env-provided one; a
  key only in env still resolves.
- A credential entered at runtime is used by the **next** discovery job with no restart
  (drive a job after `set()` and assert the provider client authenticates).
- `GET .../credentials` returns hints only; no field ever contains the value; verified
  across GitHub and GitLab connections.
- `PUT` rotation keeps the connection id and its monitoring state stable; writes exactly
  one audit row with no value in it.
- All credential endpoints 403 for viewers and 409 in demo mode.
- Vault `set()` adapter (Key Vault) writes when scope is present and surfaces a clean,
  non-fatal fallback to the `db` store when it is absent.

---

## Phase C — ongoing discovery & review

The scheduled re-discovery pass already exists and runs under the configured scheduler
([ADR-018](../adr/ADR-018-scheduler-drivers.md)); reconciliation on a cadence is a
settled decision ([ADR-006](../adr/README.md)). Phase C adds *awareness* of what
changed, not a new discovery mechanism.

### C1 — New-repo default: recommendation

When discovery finds a repository created after onboarding, what state should it get?

- **Option 1 — default `monitored` (recommended).** The repo joins the estate and
  health/enrichment immediately. Nothing a user just created silently escapes
  monitoring — and the whole point of the product is to catch the failing pipeline in
  the repo you *didn't* remember to onboard. This matches today's behavior and the
  escalation pipeline's assumptions.
- **Option 2 — default `pending`.** The repo is discovered but excluded from the estate
  until an operator approves it. Cleaner for very large estates, but it means a
  brand-new repo with a broken default branch is invisible exactly when it most needs
  attention, and it adds a state that enrichment/health must learn to skip.

**Recommendation: Option 1 — default `monitored`, and *surface* new repos for review
rather than gate them.** An operator who wants Option 2's behavior for a specific noisy
org ignores that org; new repos under an ignored workspace inherit exclusion via A2/A3.
If the owner later wants a true triage queue, `pending` is available as a third TEXT
value with no schema change — recorded as an open question below.

### C2 — "New since last review" surfacing

The Command Center already lists "newly discovered repositories" (design pack) and
`getOverviewCounts` computes a `new7d` count (`repositories.ts:296`). Add a durable
"last reviewed" marker so "new" means "new since *you* last looked," not a rolling
7-day window:

- Store `estate.last_reviewed_at` in the existing `meta` table
  (`migrations/0001_initial.sql:265`) — a key/value row, no schema change.
- Add `GET /api/v1/estate/new-since-review` → repositories with
  `first_seen_at > estate.last_reviewed_at`, joined to their workspace.
- Add `POST /api/v1/estate/mark-reviewed` (requireAdmin) → stamps `now()` into the
  meta row and clears the badge.

### C3 — Weekly digest via the existing escalation webhook

RepoWrangler already has one outbound notification hook: `NOTIFY_WEBHOOK_URL`
(`bindings.ts:79`), fired on health escalation (`scheduled/index.ts:566`). Reuse it for
a periodic estate digest — "N repositories discovered since your last review; M
workspaces unmonitored" — posted on the configured cadence when the count is non-zero.
No new notification channel; it rides the same `INotificationProvider` seam the
escalation path uses.

### C4 — Cadence setting

Add an admin-visible setting for re-discovery/digest cadence (e.g. `daily` | `weekly` |
`off`), stored in `meta`. On Cloudflare the cron trigger frequency is fixed by
`wrangler.jsonc`; the setting gates whether a given tick *acts*, rather than changing
the trigger itself — consistent with the scheduler-driver model
([ADR-018](../adr/ADR-018-scheduler-drivers.md)), where a self-hosted external ticker
POSTs the run endpoint and the app decides whether work is due.

### Phase C test plan

- `new-since-review` returns only repos first seen after the marker; `mark-reviewed`
  advances the marker and empties the list.
- Digest posts to `NOTIFY_WEBHOOK_URL` only when the new-since-review count is non-zero
  and cadence is not `off`.
- New repo under a monitored workspace defaults to `monitored` and enters the estate;
  new repo under an ignored workspace stays out.

---

## Data-model deltas

**Phases A and C are schema-free; Phase B adds exactly one table.**

- **Phase A — none.** `monitoring_state` exists on both `workspaces` and `repositories`
  and is TEXT, so a future `pending` value needs no migration.
- **Phase C — none.** The `meta` table absorbs `last_reviewed_at` and the cadence
  setting as key/value rows.
- **Phase B — one new table, `connection_secrets`** (schema in "Credential entry"),
  the encrypted-at-rest home for the credentials the wizard collects. This is the
  single justified addition, and it exists only because the owner's requirement —
  enter credentials in the UI, no out-of-band vault seeding — needs a store the app can
  **write at runtime**, which the read-only boot seam (ADR-017) cannot provide.
  `provider_connections.secret_reference` (already present, unused) becomes the pointer
  into it; no new column is needed there.

A **per-connection allowlist table is not warranted.** The `workspaces` table already
*is* the allowlist: it is connection-scoped (`connection_id`), uniquely keyed
(`connection_id, external_id`), and carries `monitoring_state`. Selecting groups in the
wizard writes workspace rows; ignoring an org flips one column. Adding a parallel
allowlist table would duplicate that relationship and create a second source of truth
for "what do we monitor," which is exactly the ambiguity `monitoring_state` was added
to avoid. If the owner later needs pre-selection of groups *before* discovery has run
(selecting a group we have not yet seen), that is still a workspace row inserted ahead
of discovery — not a new table.

---

## Rollout

1. **Phase A** ships first, backend-only, no UI, no schema, no migration. Safe on every
   existing deployment (all rows default to `monitored`; filters are no-ops). Reviewable
   and testable in isolation — a coder can build it from the A1–A4 sections without
   guessing.
2. **Phase B** ships once the `WritableSecretProvider` / `connection_secrets` store is
   built (extending the ADR-017 seam with a runtime-write backend), the
   `SECRET_ENCRYPTION_KEY` infrastructure secret is provisioned, and the
   GitLab-groups-from-DB change (B4) lands. The env-var configuration path keeps working
   throughout — an operator who prefers to pre-seed credentials is never forced into the
   wizard.
3. **Phase C** ships last; it depends only on Phase A's state semantics and the existing
   scheduler and webhook.

Record two decisions, both Context / Decision / Consequences per the ADR README
convention:

- **ADR-020 — Estate scope and monitoring state** — extends
  [ADR-004](../adr/README.md) and [ADR-006](../adr/README.md); supersedes nothing.
- **ADR-021 — Runtime-entered provider credentials** — the writable `db` secret
  backend and on-demand credential reads; **extends** rather than replaces
  [ADR-017](../adr/ADR-017-secret-provider-seam.md) (the boot seam is unchanged for
  infrastructure secrets; this adds a runtime-write path for provider credentials).

---

## Open questions for the owner

1. **New-repo default.** Confirm Option 1 (`monitored` + surface for review) over a
   `pending` triage queue (C1). Recommended: Option 1.
2. **Ignore cascade.** When an operator ignores a workspace, should its repositories'
   individual `monitoring_state` values be left intact (so re-monitoring the org
   restores prior per-repo choices) — the proposed behavior — or reset? Proposed: leave
   intact; workspace state gates independently of repo state.
3. **`GITLAB_GROUPS` env var.** Keep it permanently as a GitOps bootstrap/fallback
   (proposed), or deprecate it once the connect UI exists?
4. **Multiple connections per provider.** The schema already permits two GitHub App
   connections (e.g. two Apps across different account sets). Should the wizard expose
   that, or assume one connection per provider for v1?
5. **Cadence default.** `weekly` digest and `daily` reconciliation, or a single cadence
   for both (C4)?
6. **Ignored-repo freshness.** Should an ignored repository still receive cheap snapshot
   upserts during discovery (so its metadata stays current if re-monitored), or be
   frozen entirely until re-monitored? Proposed: workspace-level ignore skips
   pagination (frozen); repo-level ignore still gets the free snapshot but no
   enrichment.
7. **Credential store default vs. vault.** Confirm the `db` (encrypted, in-database)
   store as the default persistence for wizard-entered credentials on every backend,
   with "write to the configured vault" as an opt-in when the identity has write scope
   (Credential entry). Recommended: `db` default — it is what makes "enter it in the
   wizard, no restart" true on every host.
8. **Encryption key custody.** `SECRET_ENCRYPTION_KEY` is a new infrastructure secret
   and a backup obligation (lose it, lose the stored credentials). Confirm it is
   provisioned like `SESSION_SECRET` today, and whether a documented re-key procedure is
   needed for v1.
