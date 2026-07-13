# Azure Container Apps — self-hosted on Azure

Run the whole product (SPA + API + scheduler) on **Azure Container Apps**, with
the SQLite database on a persistent **Azure Files** share and real-mode secrets
in **Key Vault**. This deploys the same `apps/server` container that
`docker compose up` runs locally — the verified SQLite host. No Cloudflare, no
Postgres required.

| | |
|---|---|
| **Topology** | C — Self-hosted (one container serves SPA + API) |
| **Compute** | Azure Container Apps, 0.5 vCPU / 1 GiB, single replica |
| **Storage** | Azure Files share mounted at `/app/data` (SQLite) |
| **Secrets** | Key Vault references via the app's managed identity |
| **Cost** | Container Apps consumption + a Standard_LRS storage account — a few USD/month at idle |

> **Single replica by design.** SQLite is single-writer, so the app is pinned to
> one replica (which also owns the scheduler). Horizontal scale is the Postgres
> adapter's job (roadmap PN-1), not this host.

## Prerequisites

- Azure CLI (`az login`) with rights to create resources in a subscription.
- An existing **Azure Container Registry** (`az acr create -n <acr> -g <rg> --sku Basic`).
- Bash. **No local Docker** — the image is built in ACR with `az acr build`.

## Deploy (demo mode)

```bash
RESOURCE_GROUP=rg-repo-wrangler LOCATION=eastus ACR_NAME=<youracr> \
  deploy/azure-container-apps/deploy.sh
```

The script builds the image in ACR, deploys `main.bicep`, and prints the app
URL. Open it — demo mode, mock data, no secrets.

## Deploy (real mode)

1. Create a Key Vault and seed the six GitHub App secrets (names matter — the
   bicep references them):

   ```bash
   az keyvault create -n <kv> -g rg-repo-wrangler -l eastus
   az keyvault secret set --vault-name <kv> --name github-app-id           --value <id>
   az keyvault secret set --vault-name <kv> --name github-app-private-key   --file  private-key.pem
   az keyvault secret set --vault-name <kv> --name github-webhook-secret    --value <secret>
   az keyvault secret set --vault-name <kv> --name github-client-id         --value <id>
   az keyvault secret set --vault-name <kv> --name github-client-secret     --value <secret>
   az keyvault secret set --vault-name <kv> --name session-secret           --value "$(openssl rand -hex 32)"
   ```

2. Deploy with real mode on. The script grants the app's managed identity
   **Key Vault Secrets User** and reminds you to restart:

   ```bash
   DEMO_MODE=false KEY_VAULT_NAME=<kv> ALLOWED_GITHUB_USERS=<your-login> \
   PUBLIC_BASE_URL=https://<your-domain> \
   RESOURCE_GROUP=rg-repo-wrangler ACR_NAME=<youracr> \
     deploy/azure-container-apps/deploy.sh
   ```

3. Point your GitHub App's OAuth callback and webhook URL at `PUBLIC_BASE_URL`.

## Validate

```bash
FQDN=$(az containerapp show -g rg-repo-wrangler -n repo-wrangler --query properties.configuration.ingress.fqdn -o tsv)
curl -s https://$FQDN/health/live     # {"ok":true,"version":"0.3.0"}
curl -s https://$FQDN/health/ready    # {"ok":true,"demoMode":true|false}
```

## Update

Re-run `deploy.sh` — it rebuilds the image and pushes a new revision. Migrations
apply automatically at boot; the Azure Files share keeps your data across
revisions.

## Clean up

```bash
az group delete -n rg-repo-wrangler --yes --no-wait
```

## Next: Entra ID sign-in and Postgres

Entra sign-in (`IAuthenticationProvider`, PN-5) and a Postgres backend for
multi-replica scale (PN-1) are the follow-on platform-neutrality milestones. The
Container Apps recipe already isolates their seams: swap `AUTH_MODE` and the
`SQLITE_PATH`/database env once those adapters land — the infrastructure here
does not change.
