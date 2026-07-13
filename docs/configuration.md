# Configuration reference

Every RepoWrangler setting, what it does, whether it is secret, and where you set
it per deployment target. The application reads a single flat set of values — on
Cloudflare they come from `wrangler.jsonc` vars and `wrangler secret put`; on the
Node host (Docker, Azure Container Apps, Kubernetes) they come from environment
variables / `.env` / Key Vault / a Kubernetes Secret. The **names are identical**
everywhere.

> **Secrets are never committed.** Anything marked *secret* below must come from
> your platform's secret store (Cloudflare secrets, Key Vault, a K8s `Secret`, or
> an un-committed `.env`) — never from a file in the repository. See
> [security.md](security.md).

## Where each target reads configuration

| Target | Non-secret config | Secrets |
|---|---|---|
| Cloudflare Worker | `wrangler.jsonc` `vars` | `wrangler secret put NAME` |
| Docker / compose | `.env` (compose reads repo-root `.env`) | same `.env` (keep it un-committed) |
| Azure Container Apps | Container App env vars | Key Vault refs via managed identity |
| Kubernetes | `ConfigMap` | `Secret` (or external-secrets) |
| Decoupled SPA | `VITE_*` at build time | n/a (SPA holds no secrets) |

## Core

| Setting | Secret | Default | Description |
|---|---|---|---|
| `DEMO_MODE` | no | `true` (public default) | `true` = mock data, sign-in bypassed, no secrets. `false` = real mode (a data provider must be configured). Also auto-falls back to demo if no GitHub App is set. |
| `AUTH_PROVIDERS` | no | — | Ordered CSV of enabled sign-in providers: `github,gitlab,entra,google,local` (ADR-019). Supersedes `AUTH_MODE`; a provider appears only if also configured. See [Sign-in providers](#sign-in-providers-pn-5). |
| `AUTH_MODE` | no | `github_app` | Legacy single-provider selector, used only when `AUTH_PROVIDERS` is empty: `github_app` or `entra`. |
| `PUBLIC_BASE_URL` | no | request origin | Public URL of this instance; used to build OAuth callback URLs and links. Must match the redirect URI registered with your identity provider. |
| `SESSION_SECRET` | **yes** | — | Long random string that signs the session cookie (HMAC-SHA-256). Required in real mode. Generate with `openssl rand -base64 48`. |
| `DEFAULT_RETENTION_DAYS` | no | provider default | Days of pipeline-run / webhook history to retain before compaction. |

## Storage (Node host only)

| Setting | Secret | Default | Description |
|---|---|---|---|
| `SQLITE_PATH` | no | `./data/repo-wrangler.db` (`/app/data/…` in Docker) | SQLite database file location. Used when `DATABASE_URL` is empty. |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/db?sslmode=require`. Set to use PostgreSQL instead of SQLite — required for **multiple API replicas** sharing one database. See [ADR-015](adr/ADR-015-postgres-storage-adapter.md). |
| `MIGRATIONS_DIR` | no | `./migrations` | Directory of ordered `*.sql` migrations applied at boot. |
| `WEB_DIST` | no | `apps/web/dist` | Directory of the built SPA the host serves. |
| `PORT` | no | `8080` | TCP port the Node host listens on. |
| `ENABLE_SCHEDULER` | no | `true` | Run the in-process sync scheduler. With multiple replicas on PostgreSQL, set `false` on all but **one** replica. |

On Cloudflare, storage is the D1 binding `DB` in `wrangler.jsonc` (`database_id`)
— not an environment variable.

## Secrets source (PN-4, Node host)

> **Maturity:** every backend below is implemented and unit-tested and is a
> supported deployment option. Validate your chosen backend against your real
> vault before production — pre-1.0.

Where the host reads its secrets from ([ADR-017](adr/ADR-017-secret-provider-seam.md)).
Every non-`env` source falls through to environment variables for anything it does
not supply.

No cloud is required — the external-vault options span self-hosted (HashiCorp
Vault) and every major cloud. Env names map to vault keys by lower-kebab
(`GITHUB_CLIENT_SECRET` → `github-client-secret`). Every non-`env` source falls
through to environment variables.

| Setting | Secret | Default | Description |
|---|---|---|---|
| `SECRET_SOURCE` | no | `env` | `env` · `file` · `keyvault` (Azure) · `vault` (HashiCorp) · `aws` · `gcp` · `composite` (file → configured vaults → env). |
| `SECRETS_DIR` | no | `/run/secrets` | `file`: directory of mounted secret files. Also covers **any CSI driver** (AWS/GCP/Vault) that mounts secrets as files. |
| `KEY_VAULT_URI` / `AZURE_CLIENT_ID` | no | — | `keyvault`: Azure Key Vault URI (managed identity, no static credential); optional user-assigned identity client id. |
| `VAULT_ADDR` / `VAULT_TOKEN` | **yes** | — | `vault`: HashiCorp Vault address + token (cloud-neutral, runs anywhere). |
| `VAULT_KV_MOUNT` / `VAULT_KV_PREFIX` / `VAULT_NAMESPACE` | no | `secret` | `vault`: KV v2 mount, optional key prefix, optional Enterprise/HCP namespace. |
| `AWS_REGION` + `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | **yes** | — | `aws`: AWS Secrets Manager (SigV4). Creds from the standard AWS env / instance role. |
| `AWS_SECRET_PREFIX` | no | — | `aws`: optional secret-id prefix. |
| `GCP_PROJECT` | no | — | `gcp`: Google Secret Manager project; token from the metadata server / workload identity. |

## Scheduler driver (PN-3, Node host)

How periodic sync and daily maintenance are triggered
([ADR-018](adr/ADR-018-scheduler-drivers.md)). On Cloudflare, cron triggers always
call the `scheduled` handler; this is a Node-host concern.

| Setting | Secret | Default | Description |
|---|---|---|---|
| `SCHEDULER_MODE` | no | `in-process` | `in-process` (internal timer) · `external` (no timer; an outside ticker POSTs `/internal/cron/run`) · `off` (no scheduling). |
| `CRON_TRIGGER_TOKEN` | **yes** | — | Shared bearer token authorizing `POST /internal/cron/run?job=periodic\|daily` when `SCHEDULER_MODE=external`. The endpoint is inert without both. |

Example external ticker (Linux cron, K8s CronJob, GitHub Actions, Azure Functions timer):

```sh
curl -fsS -X POST -H "authorization: Bearer $CRON_TRIGGER_TOKEN" \
  "$PUBLIC_BASE_URL/internal/cron/run?job=periodic"
```

## GitHub App (data provider)

Required in real mode when monitoring GitHub. See
[Providers → GitHub App](providers/github-app.md).

| Setting | Secret | Description |
|---|---|---|
| `GITHUB_APP_ID` | no* | Numeric App ID. (*Presence toggles real mode.) |
| `GITHUB_APP_PRIVATE_KEY` | **yes** | The App's PEM private key (single line or `\n`-escaped). |
| `GITHUB_CLIENT_ID` | no | OAuth client ID for user sign-in. |
| `GITHUB_CLIENT_SECRET` | **yes** | OAuth client secret for user sign-in. |
| `GITHUB_WEBHOOK_SECRET` | **yes** | Verifies inbound GitHub webhook signatures. |
| `ALLOWED_GITHUB_USERS` | no | Comma-separated GitHub logins allowed to sign in; first = owner, rest = admins. |
| `ALLOWED_GITHUB_ORGS` | no | Comma-separated orgs to scope discovery to (optional). |

## Sign-in providers (PN-5)

> **Maturity:** every provider below is implemented and unit-tested and is a
> supported sign-in option. Validate the OAuth/OIDC flow against your identity
> provider before production — pre-1.0.

Authentication is a set of swappable providers behind one signed session cookie
([ADR-019](adr/ADR-019-authentication-provider-registry.md)). Enable any
combination with `AUTH_PROVIDERS` (ordered CSV); each appears on the sign-in
screen only when it is also configured. For every provider, `*_ALLOWED_USERS` is a
CSV where the **first principal is the owner** and the rest are admins. Each
provider registers a redirect URI of `{PUBLIC_BASE_URL}/auth/<id>/callback`.

**GitHub** (`github`) — OAuth via the GitHub App user-authorization flow. Uses
`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (see GitHub App above) and
`ALLOWED_GITHUB_USERS`.

**GitLab** (`gitlab`) — OAuth 2.0; works with gitlab.com or self-managed
(`GITLAB_BASE_URL`), scope `read_user`.

| Setting | Secret | Description |
|---|---|---|
| `GITLAB_CLIENT_ID` | no | GitLab OAuth application id. |
| `GITLAB_CLIENT_SECRET` | **yes** | GitLab OAuth application secret. |
| `GITLAB_ALLOWED_USERS` | no | Comma-separated GitLab usernames; first = owner. |

**Microsoft Entra ID** (`entra`) — OpenID Connect. Also selectable via the legacy
`AUTH_MODE=entra`. See [Providers → Entra ID](providers/entra.md).

| Setting | Secret | Description |
|---|---|---|
| `ENTRA_TENANT_ID` | no | Directory (tenant) ID, or `organizations` / `common`. |
| `ENTRA_CLIENT_ID` | no | Application (client) ID. |
| `ENTRA_CLIENT_SECRET` | **yes** | The Entra app's client secret. |
| `ENTRA_ALLOWED_USERS` | no | Sign-in names (UPN/email); first = owner. |

**Google** (`google`) — OpenID Connect; the verified email is the identity.

| Setting | Secret | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | no | Google OAuth 2.0 client id. |
| `GOOGLE_CLIENT_SECRET` | **yes** | Google OAuth 2.0 client secret. |
| `GOOGLE_ALLOWED_USERS` | no | Google account emails; first = owner. |

**Local-dev** (`local`) — **development only**, password-less. Active *only* when
`local` is in `AUTH_PROVIDERS` **and** `LOCAL_DEV_USERS` is set. Never enable in
production.

| Setting | Secret | Description |
|---|---|---|
| `LOCAL_DEV_USERS` | no | Usernames offered on the local sign-in form; first = owner. |

## GitLab (data provider, optional)

See [Providers → GitLab](providers/gitlab.md).

| Setting | Secret | Default | Description |
|---|---|---|---|
| `GITLAB_TOKEN` | **yes** | — | Read-only GitLab access token. Presence + `GITLAB_GROUPS` enables GitLab. |
| `GITLAB_BASE_URL` | no | `https://gitlab.com` | Base URL for self-managed GitLab. |
| `GITLAB_GROUPS` | no | — | Comma-separated top-level group paths to monitor. |
| `GITLAB_WEBHOOK_SECRET` | **yes** | — | Verifies inbound GitLab webhook signatures (optional). |

## Frontend / networking

| Setting | Secret | Default | Description |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | no | empty (same-origin) | Comma-separated exact SPA origins allowed to call the API cross-origin. Set only for the **decoupled** frontend topology (ADR-011, Mode B). Empty = integrated same-origin. |
| `VITE_API_BASE_URL` | no (build-time) | empty | SPA build var: absolute API base for a decoupled SPA. Empty = same-origin. |
| `VITE_BASE_PATH` | no (build-time) | `/` | SPA base path when hosted under a sub-path (e.g. GitHub Pages project site). |
| `VITE_DEFAULT_THEME` | no (build-time) | `light` | Default UI theme id. See [theming guide](guide/theming.md). |

## Notifications (optional)

| Setting | Secret | Description |
|---|---|---|
| `NOTIFY_WEBHOOK_URL` | **yes** | Outbound webhook for critical/high attention escalations. Empty = disabled. |

## Minimal configurations

**Demo (any target):** nothing required — `DEMO_MODE=true` is the default.

**Real GitHub, self-hosted (SQLite):**

```ini
DEMO_MODE=false
PUBLIC_BASE_URL=https://repowrangler.example.com
SESSION_SECRET=<openssl rand -base64 48>
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=<pem>
GITHUB_CLIENT_ID=Iv1.abc123
GITHUB_CLIENT_SECRET=<secret>
GITHUB_WEBHOOK_SECRET=<secret>
ALLOWED_GITHUB_USERS=your-login
```

**Real GitHub + Postgres + Entra sign-in (Azure Container Apps / Kubernetes):**
add to the above:

```ini
DATABASE_URL=postgres://user:pass@db:5432/repowrangler?sslmode=require
AUTH_MODE=entra
ENTRA_TENANT_ID=<guid>
ENTRA_CLIENT_ID=<guid>
ENTRA_CLIENT_SECRET=<secret>
ENTRA_ALLOWED_USERS=you@example.com
# with >1 replica, ENABLE_SCHEDULER=false on all but one
```

The full example file is [`apps/server/.env.example`](../apps/server/.env.example);
the Cloudflare dev equivalent is [`.dev.vars.example`](../.dev.vars.example).
