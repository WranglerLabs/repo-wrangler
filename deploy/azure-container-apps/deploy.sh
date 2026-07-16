#!/usr/bin/env bash
# RepoWrangler — deploy to Azure Container Apps.
#
# Builds the apps/server image in ACR (no local Docker needed) and deploys the
# Container App + Log Analytics via main.bicep. Runs in demo mode (SQLite on
# Azure Files) by default; for production pass POSTGRES=true and a Key Vault
# holding a `database-url` secret. Windows/PowerShell users: use deploy.ps1.
#
# Usage (demo):
#   RESOURCE_GROUP=rg-repo-wrangler LOCATION=eastus ACR_NAME=myacr ./deploy.sh
#
# Production (PostgreSQL + real mode — after seeding the vault, see README):
#   DEMO_MODE=false POSTGRES=true KEY_VAULT_NAME=my-kv ALLOWED_GITHUB_USERS=you \
#   PUBLIC_BASE_URL=https://repo-wrangler.example.com \
#   RESOURCE_GROUP=rg-repo-wrangler ACR_NAME=myacr ./deploy.sh
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:?set RESOURCE_GROUP}"
LOCATION="${LOCATION:-eastus}"
ACR_NAME="${ACR_NAME:?set ACR_NAME (an existing Azure Container Registry)}"
NAME="${NAME:-repo-wrangler}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DEMO_MODE="${DEMO_MODE:-true}"
POSTGRES="${POSTGRES:-false}"
KEY_VAULT_NAME="${KEY_VAULT_NAME:-}"
ALLOWED_GITHUB_USERS="${ALLOWED_GITHUB_USERS:-}"
AUTH_PROVIDERS="${AUTH_PROVIDERS:-github}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
ENABLE_SCHEDULER="${ENABLE_SCHEDULER:-true}"
CUSTOM_DOMAIN_NAME="${CUSTOM_DOMAIN_NAME:-}"
CUSTOM_DOMAIN_CERTIFICATE_NAME="${CUSTOM_DOMAIN_CERTIFICATE_NAME:-}"
MANAGED_IDENTITY_NAME="${MANAGED_IDENTITY_NAME:-${NAME}-id}"
# Per-resource (CAF) names — override any of these for naming-standard compliance
# (e.g. CONTAINER_APP_NAME=ca-rw-prod-eus CONTAINERAPPS_ENV_NAME=cae-rw-prod-eus).
CONTAINER_APP_NAME="${CONTAINER_APP_NAME:-$NAME}"
CONTAINERAPPS_ENV_NAME="${CONTAINERAPPS_ENV_NAME:-${NAME}-env}"
LOG_ANALYTICS_NAME="${LOG_ANALYTICS_NAME:-${NAME}-logs}"
STORAGE_ACCOUNT_NAME="${STORAGE_ACCOUNT_NAME:-}"

if [[ "$POSTGRES" == "true" && -z "$KEY_VAULT_NAME" ]]; then
  echo "POSTGRES=true requires KEY_VAULT_NAME (the vault holding the database-url secret)." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ACR_LOGIN_SERVER="$(az acr show -n "$ACR_NAME" --query loginServer -o tsv)"
IMAGE="${ACR_LOGIN_SERVER}/${NAME}-server:${IMAGE_TAG}"

echo "==> Ensuring resource group $RESOURCE_GROUP ($LOCATION)"
az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

echo "==> Building image in ACR: $IMAGE  (from apps/server/Dockerfile)"
# Cloud build — no local Docker daemon required. NOTE (Windows): az acr build
# can crash locally with a cp1252 UnicodeEncodeError while STREAMING logs — the
# build itself still runs in ACR; verify with `az acr repository show-tags`.
az acr build -r "$ACR_NAME" -t "${NAME}-server:${IMAGE_TAG}" \
  -f "$REPO_ROOT/apps/server/Dockerfile" "$REPO_ROOT"

# The template pulls images and resolves Key Vault references with a
# user-assigned identity. Create it and grant vault access BEFORE the
# deployment, so the FIRST deploy succeeds (secret refs resolve at deploy time).
if [[ -n "$KEY_VAULT_NAME" ]]; then
  echo "==> Ensuring user-assigned identity $MANAGED_IDENTITY_NAME has vault access"
  az identity create -n "$MANAGED_IDENTITY_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" -o none
  MI_PRINCIPAL="$(az identity show -n "$MANAGED_IDENTITY_NAME" -g "$RESOURCE_GROUP" --query principalId -o tsv)"
  VAULT_ID="$(az keyvault show -n "$KEY_VAULT_NAME" --query id -o tsv)"
  az role assignment create --assignee-object-id "$MI_PRINCIPAL" \
    --assignee-principal-type ServicePrincipal \
    --role "Key Vault Secrets User" --scope "$VAULT_ID" -o none 2>/dev/null || true
fi

echo "==> Deploying Container App (demoMode=$DEMO_MODE postgres=$POSTGRES)"
DEPLOY_OUT="$(az deployment group create \
  -g "$RESOURCE_GROUP" \
  -f "$REPO_ROOT/deploy/azure-container-apps/main.bicep" \
  -p name="$NAME" location="$LOCATION" image="$IMAGE" \
     acrLoginServer="$ACR_LOGIN_SERVER" acrName="$ACR_NAME" \
     demoMode="$DEMO_MODE" postgres="$POSTGRES" keyVaultName="$KEY_VAULT_NAME" \
     managedIdentityName="$MANAGED_IDENTITY_NAME" \
     containerAppName="$CONTAINER_APP_NAME" \
     containerAppsEnvironmentName="$CONTAINERAPPS_ENV_NAME" \
     logAnalyticsWorkspaceName="$LOG_ANALYTICS_NAME" \
     storageAccountName="$STORAGE_ACCOUNT_NAME" \
     authProviders="$AUTH_PROVIDERS" \
     allowedGithubUsers="$ALLOWED_GITHUB_USERS" publicBaseUrl="$PUBLIC_BASE_URL" \
     enableScheduler="$ENABLE_SCHEDULER" \
     customDomainName="$CUSTOM_DOMAIN_NAME" \
     customDomainCertificateName="$CUSTOM_DOMAIN_CERTIFICATE_NAME" \
  --query properties.outputs -o json)"

APP_URL="$(az deployment group show -g "$RESOURCE_GROUP" -n main \
  --query "properties.outputs.appUrl.value" -o tsv 2>/dev/null || \
  echo "$DEPLOY_OUT" | grep -o '"appUrl":[^,}]*' | sed 's/.*"value": *"\(.*\)".*/\1/')"

echo
echo "Deployed: ${APP_URL:-check the portal}"
echo "Validate: curl -s ${APP_URL:-https://<fqdn>}/health/ready"
