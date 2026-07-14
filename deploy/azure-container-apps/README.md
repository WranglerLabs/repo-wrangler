# Azure Container Apps — self-hosted on Azure

Run the whole product (SPA + API + scheduler) on **Azure Container Apps**. This
deploys the same `apps/server` container that `docker compose up` runs
locally — no Cloudflare required. The recipe supports two database modes:

| | |
|---|---|
| **Topology** | C — Self-hosted (one container serves SPA + API) |
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
> see [`docs/deployment.md`](../../docs/deployment.md).

## Before you begin — what you'll need

### Tools

| Tool | Notes |
|---|---|
| Azure subscription | Rights to create resource groups and role assignments in it. |
| `az` CLI, logged in | `az login`. |
| This repo, cloned | The scripts read `apps/server/Dockerfile` and `main.bicep` relative to the repo root. |
| bash **or** PowerShell 7 | `deploy.sh` and `deploy.ps1` are functionally identical — pick whichever shell you're already in. |

Nothing else needs to pre-exist. Not the resource group, not the registry,
not the Key Vault — every step below creates what it needs.

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
the input. Follow [`docs/providers/github-app.md`](../../docs/providers/github-app.md)
end to end, then come back here with six values: App ID, private key, OAuth
client ID/secret, webhook secret, plus a session secret you generate.

```bash
az keyvault create -n <kv> -g rg-repo-wrangler -l eastus

az keyvault secret set --vault-name <kv> --name github-app-id          --value <id>
az keyvault secret set --vault-name <kv> --name github-app-private-key --file  private-key.pem
az keyvault secret set --vault-name <kv> --name github-webhook-secret  --value <secret>
az keyvault secret set --vault-name <kv> --name github-client-id       --value <id>
az keyvault secret set --vault-name <kv> --name github-client-secret   --value <secret>
az keyvault secret set --vault-name <kv> --name session-secret         --value "$(openssl rand -hex 32)"
```

These six secret names are fixed — `main.bicep` references them by name. Use
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
[`docs/configuration.md`](../../docs/configuration.md)). Either script grants
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
