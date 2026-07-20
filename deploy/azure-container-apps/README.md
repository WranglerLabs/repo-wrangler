# Azure Container Apps — self-hosted on Azure

Run the whole product (SPA + API + scheduler) on **Azure Container Apps**. This
deploys the same `apps/server` container that `docker compose up` runs
locally — no Cloudflare required. The recipe supports two database modes:

## Ranch Hand production deployment

Ranch Hand is the recommended clone-free Windows path. Production data mode is
the default; demo mode must be selected explicitly. With RepoWrangler v1.0.18
or newer, Ranch Hand creates a new ownership-tagged resource group and deploys:

- Azure Container Apps with Azure-managed HTTPS;
- a dedicated Azure Database for PostgreSQL flexible server and database;
- generated session-signing, credential-encryption, PostgreSQL, and one-time
  setup secrets passed only as secure ARM parameters and stored as Container
  App secrets; and
- protected first-run onboarding for administrator identity and provider
  connections.

The secret-free Ranch Hand plan records only resource names and release
identity. Ranch Hand verifies the digest-pinned image, the exact immutable
release, HTTPS readiness, and `demoMode: false` before committing the lifecycle
operation. The manual script workflow below remains available for operators who
already own an ACR, Key Vault, and PostgreSQL service.

## Required inputs — decide these before deploying

Do not start the deployment until every value in the applicable column is
known. The scripts create the Container App resources, but they cannot choose
your subscription scope, globally unique names, public URL, or credentials.

| Input | Demo / evaluation | Production | Script input |
|---|---:|---:|---|
| Azure subscription | Required | Required | Active `az` login |
| Azure region | Required | Required | `LOCATION` / `-Location` |
| Resource group name | Required | Required | `RESOURCE_GROUP` / `-ResourceGroup` |
| Existing ACR name | Required | Required | `ACR_NAME` / `-AcrName` |
| Base application name | Optional | Required for your naming standard | `NAME` / `-Name` |
| Container App, environment, logs, and identity names | Optional; defaults from base name | Required if your naming standard controls them | See the naming table below |
| Storage account name | Optional; generated when omitted | Not used with PostgreSQL | `STORAGE_ACCOUNT_NAME` / `-StorageAccountName` |
| Existing Key Vault name | Not required | Required | `KEY_VAULT_NAME` / `-KeyVaultName` |
| Existing PostgreSQL connection string | Not required | Required in the vault | Secret `database-url` |
| Provider and application secrets | Not required | Required in the vault | Exact names below |
| Allowed GitHub login(s) | Not required | Required for GitHub sign-in | `ALLOWED_GITHUB_USERS` / `-AllowedGithubUsers` |
| Authentication providers | Not required | Required | `AUTH_PROVIDERS` / `-AuthProviders` |
| Public HTTPS base URL | Not required | Required for callbacks/webhooks | `PUBLIC_BASE_URL` / `-PublicBaseUrl` |
| Custom domain and managed-certificate name | Not required | Required only when preserving a custom-domain binding | `CUSTOM_DOMAIN_NAME`, `CUSTOM_DOMAIN_CERTIFICATE_NAME` / PowerShell equivalents |

For the manual Key Vault workflow, production's vault must contain these exact
secret names before the first deployment. Ranch Hand generates and supplies
the corresponding values through secure ARM parameters instead:

| Secret name | Required for | Value |
|---|---|---|
| `database-url` | PostgreSQL | PostgreSQL connection string with TLS enabled |
| `session-secret` | All real-mode deployments | Random 32-byte-or-longer signing secret |
| `secret-encryption-key` | All real-mode deployments | Random 32-byte encryption key |
| `setup-token` | Public first-run onboarding | Random one-time setup token |

Provider identity and estate connection credentials are configured during the
protected RepoWrangler onboarding flow and encrypted in the deployment
database; they are not required before infrastructure deployment.

Naming inputs and examples are listed in [Values you decide up
front](#values-you-decide-up-front). If your organization has a naming
standard, settle every name there before running Step 1.

| | |
|---|---|
| **Topology** | Self-hosted (one container serves SPA + API) |
| **Cost tier** | Tier 1 (SQLite mode) · Tier 2 (Postgres mode) |
| **Compute** | Azure Container Apps, 0.5 vCPU / 1 GiB, single replica |
| **Database** | **PostgreSQL** (recommended for production) via a `database-url` Key Vault secret, **or** SQLite on an Azure Files share (demo/evaluation only — see warning below) |
| **Secrets** | Key Vault references via the app's managed identity |
| **Cost** | Container Apps consumption + (SQLite mode) a Standard_LRS storage account, or (Postgres mode) a Burstable flexible server — a few USD/month at idle |

> **SQLite is demo/evaluation only.** File locking over Azure Files (SMB) is
> unreliable under restarts and crashes — a "database is locked" crash-loop is
> the classic symptom. Any deployment meant to stay up should use
> `postgres=true` (below), not the SQLite default.

> **Single replica, either mode — for now.** The template pins
> `minReplicas`/`maxReplicas` to 1/1 regardless of database. SQLite requires
> this (single-writer, and the one replica also owns the scheduler); Postgres
> removes the database constraint, but wiring up multiple replicas
> (`ENABLE_SCHEDULER=false` on all but one) isn't part of this recipe yet —
> see the [deployment guide](https://wranglerlabs.org/deployment).

## Before you begin

### Tools

| Tool | Notes |
|---|---|
| Azure subscription | Rights to create resource groups and role assignments in it. |
| `az` CLI, logged in | `az login`. |
| This repo, cloned | The scripts read `apps/server/Dockerfile` and `main.bicep` relative to the repo root. |
| bash **or** PowerShell 7 | `deploy.sh` and `deploy.ps1` are functionally identical — pick whichever shell you're already in. |

The resource group can be created by Step 1. The registry must exist before
the deploy script runs. Production also requires the Key Vault and its secrets
to exist before the first template deployment; Steps 3a and 3b create them.

### Values you decide up front

No naming standard is imposed — every name is yours to choose. If you follow
the Cloud Adoption Framework, the examples below use CAF prefixes
(`ca-`, `cae-`, `log-`, `id-`, `st`); use whatever you like.

| Value | Example | Notes |
|---|---|---|
| Resource group | `rg-repo-wrangler` | |
| Location | `eastus` | |
| ACR name | `acrrepowrangler01` | Must be globally unique. |
| App name (`-n`/`NAME`) | `repo-wrangler` | Base name; feeds the CAF defaults below. |
| Key Vault name | `kv-repo-wrangler` | Needed for real-mode secrets and/or Postgres. |
| Allowed GitHub users | `myghusername` | Comma-separated logins; first to sign in becomes owner. |
| Public base URL | `https://wrangler.example.com` | Where OAuth callbacks and webhooks point. |
| `containerAppName` | `ca-repowrangler-prod-eus` | Defaults to the app name. |
| `containerAppsEnvironmentName` | `cae-repowrangler-prod-eus` | Defaults to `<name>-env`. |
| `logAnalyticsWorkspaceName` | `log-repowrangler-prod-eus` | Defaults to `<name>-logs`. |
| `managedIdentityName` | `id-repowrangler-prod-eus` | Defaults to `<name>-id`. |
| `storageAccountName` | `strepowranglerprodeus` | SQLite mode only; 3–24 lowercase alphanumerics, globally unique. Ignored when `postgres=true`. |

## Step 1 — create a resource group and registry

**bash:**

```bash
az group create -n rg-repo-wrangler -l eastus
az acr create -n <youracr> -g rg-repo-wrangler --sku Basic
```

**PowerShell:**

```powershell
az group create -n rg-repo-wrangler -l eastus
az acr create -n <youracr> -g rg-repo-wrangler --sku Basic
```

## Step 2 — deploy (demo mode)

Demo mode needs nothing else: mock data, no provider secrets, SQLite on Azure
Files.

**bash (`deploy.sh`):**

```bash
RESOURCE_GROUP=rg-repo-wrangler LOCATION=eastus ACR_NAME=<youracr> \
  deploy/azure-container-apps/deploy.sh
```

**PowerShell (`deploy.ps1`):**

```powershell
./deploy/azure-container-apps/deploy.ps1 `
    -ResourceGroup rg-repo-wrangler -Location eastus -AcrName <youracr>
```

Either script builds the image in ACR (`az acr build` — no local Docker
needed), deploys `main.bicep`, and prints the app URL.

## Step 3 — validate

```bash
FQDN=$(az containerapp show -g rg-repo-wrangler -n repo-wrangler --query properties.configuration.ingress.fqdn -o tsv)
curl -s https://$FQDN/health/live     # {"ok":true,"version":"0.5.0"}
curl -s https://$FQDN/health/ready    # {"ok":true,"demoMode":true|false}
```

You now have a working demo instance. Everything below turns it into a
production one.

## Going production

### 3a. Register the GitHub App and seed secrets

The GitHub App has to exist before you can seed its secrets — its values are
the input. Follow the [GitHub App guide](https://wranglerlabs.org/providers/github-app)
end to end, then come back here with seven values: App ID, private key, OAuth
client ID/secret, webhook secret, a session secret, and a secret-encryption key.

```bash
az keyvault create -n <kv> -g rg-repo-wrangler -l eastus

az keyvault secret set --vault-name <kv> --name github-app-id          --value <id>
az keyvault secret set --vault-name <kv> --name github-app-private-key --file  private-key.pem
az keyvault secret set --vault-name <kv> --name github-webhook-secret  --value <secret>
az keyvault secret set --vault-name <kv> --name github-client-id       --value <id>
az keyvault secret set --vault-name <kv> --name github-client-secret   --value <secret>
az keyvault secret set --vault-name <kv> --name session-secret         --value "$(openssl rand -hex 32)"
az keyvault secret set --vault-name <kv> --name secret-encryption-key   --value "$(openssl rand -hex 32)"
```

These seven secret names are fixed — `main.bicep` references them by name. Use
`--file`, not `--value`, for `github-app-private-key`: `--value` truncates a
multiline PEM at the first newline, and the app fails to start with a
malformed-key error.

### 3b. Provision PostgreSQL

```bash
az postgres flexible-server create \
  -g rg-repo-wrangler -n <pg-server-name> -l eastus \
  --tier Burstable --sku-name Standard_B1ms \
  --storage-size 32 --version 16 \
  --admin-user repowrangler --admin-password <strong-password> \
  --public-access 0.0.0.0

az postgres flexible-server db create \
  -g rg-repo-wrangler -s <pg-server-name> -d repowrangler

az keyvault secret set --vault-name <kv> --name database-url \
  --value "postgresql://repowrangler:<strong-password>@<pg-server-name>.postgres.database.azure.com:5432/repowrangler?sslmode=require"
```

`--public-access 0.0.0.0` allows any Azure service, including Container Apps,
to reach the server — the simplest option since Container Apps consumption
plan doesn't have a fixed egress IP. For a locked-down setup, VNet-integrate
the Container Apps environment instead (out of scope here).

`database-url` is a fixed secret name too — `main.bicep` reads it as
`DATABASE_URL` only when `postgres=true`.

### 3c. Deploy in production mode

**bash:**

```bash
DEMO_MODE=false POSTGRES=true KEY_VAULT_NAME=<kv> \
ALLOWED_GITHUB_USERS=<your-login> AUTH_PROVIDERS=github \
PUBLIC_BASE_URL=https://wrangler.example.com \
RESOURCE_GROUP=rg-repo-wrangler ACR_NAME=<youracr> \
  deploy/azure-container-apps/deploy.sh
```

**PowerShell:**

```powershell
./deploy/azure-container-apps/deploy.ps1 `
    -ResourceGroup rg-repo-wrangler -Location eastus -AcrName <youracr> `
    -DemoMode:$false -Postgres -KeyVaultName <kv> `
    -AllowedGithubUsers <your-login> -AuthProviders github `
    -PublicBaseUrl https://wrangler.example.com
```

`AUTH_PROVIDERS`/`-AuthProviders` takes a comma-separated list — combinations
like `entra,github` are supported if you've also registered an Entra app (see
[configuration reference](https://wranglerlabs.org/configuration)). Either script grants
the app's managed identity **Key Vault Secrets User** on your vault *before*
deploying, so the first revision's secret references resolve.

### 3d. Point the GitHub App at your public URL

Now that the instance has a real public URL, go back to the GitHub App's
settings and set:

- **Webhook URL:** `https://wrangler.example.com/webhooks/github`
- **Callback URL (OAuth):** `https://wrangler.example.com/auth/github/callback`

These are read at request time, not baked into the image — no redeploy
needed.

### 3e. Custom domain

```bash
FQDN=$(az containerapp show -g rg-repo-wrangler -n repo-wrangler --query properties.configuration.ingress.fqdn -o tsv)
VERIFICATION_ID=$(az containerapp show -g rg-repo-wrangler -n repo-wrangler --query properties.customDomainVerificationId -o tsv)
echo "CNAME  wrangler -> $FQDN"
echo "TXT    asuid.wrangler -> $VERIFICATION_ID"
```

Create both DNS records, then bind the domain and let Azure issue a managed
certificate:

```bash
az containerapp hostname add -g rg-repo-wrangler -n repo-wrangler --hostname wrangler.example.com
az containerapp env certificate create -g rg-repo-wrangler -n repo-wrangler-env \
  --hostname wrangler.example.com --certificate-type managed --validation-method CNAME
az containerapp hostname bind -g rg-repo-wrangler -n repo-wrangler \
  --hostname wrangler.example.com --environment repo-wrangler-env --certificate managed
```

Keep the CNAME **un-proxied** (DNS-only, no CDN/orange-cloud) until the
certificate issues — a proxied record fails Azure's domain validation.
Flags shift between `az` CLI versions; if a command errors, check
`az containerapp hostname bind --help`.

After Azure issues the certificate, record its managed-certificate name and
pass both values on every later template deployment. This keeps a declarative
redeploy from removing the hostname binding:

```bash
CUSTOM_DOMAIN_NAME=wrangler.example.com \
CUSTOM_DOMAIN_CERTIFICATE_NAME=<managed-certificate-name> \
  deploy/azure-container-apps/deploy.sh
```

PowerShell uses `-CustomDomainName` and
`-CustomDomainCertificateName`. The Bicep parameters have the same camel-case
names for a `.bicepparam` file.

## How identity works

The template creates a **user-assigned** managed identity and grants it
`AcrPull` on the registry in-template. A system-assigned identity can't do
this: it doesn't exist until the app is created, but the app's first revision
needs to pull its image *at* creation — a chicken-and-egg problem the old
system-identity approach couldn't solve. The deploy scripts additionally
grant that identity **Key Vault Secrets User** on your vault before deploying,
so Key Vault secret references resolve on the very first revision too.

## Troubleshooting

**`az acr build` crashes with `UnicodeEncodeError` (Windows).**
This is a cp1252 encoding bug in the log-streaming client, not a build
failure — the build itself completes server-side in ACR. Verify with:

```bash
az acr repository show-tags -n <youracr> --repository repo-wrangler-server
```

If the tag you expect is there, the image is fine; re-run the deploy script
and it'll pick it up.

**Crash-loop with "database is locked".**
You're on SQLite over Azure Files, which doesn't handle file locking
reliably under restarts. Switch to `postgres=true` (see [Going
production](#going-production)).

**Image pull fails with a 401 / "ACR token exchange" error.**
The app's managed identity is missing `AcrPull` on the registry. This
template grants it automatically, so seeing this error means the identity or
role assignment was deleted out-of-band — check `az role assignment list
--scope <acr-resource-id>`.

## Update

Re-run the deploy script — it rebuilds the image and pushes a new revision.
Migrations apply automatically at boot; your data (Azure Files share or
Postgres database) persists across revisions.

## Clean up

```bash
az group delete -n rg-repo-wrangler --yes --no-wait
```

Same command in PowerShell — it's `az` CLI either way. If you provisioned
Postgres or a Key Vault in a different resource group, delete those
separately.
