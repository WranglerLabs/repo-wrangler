#!/usr/bin/env bash
# RepoWrangler — deploy to Azure Container Apps.
#
# Builds the apps/server image in ACR (no local Docker needed) and deploys the
# Container App + Azure Files volume + Log Analytics via main.bicep. Runs in
# demo mode by default; pass a Key Vault name and DEMO_MODE=false for real mode.
#
# Usage:
#   RESOURCE_GROUP=rg-repo-wrangler LOCATION=eastus ACR_NAME=myacr ./deploy.sh
#
# Real mode (after seeding the vault — see README):
#   DEMO_MODE=false KEY_VAULT_NAME=my-kv ALLOWED_GITHUB_USERS=you \
#   PUBLIC_BASE_URL=https://repo-wrangler.example.com \
#   RESOURCE_GROUP=rg-repo-wrangler ACR_NAME=myacr ./deploy.sh
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:?set RESOURCE_GROUP}"
LOCATION="${LOCATION:-eastus}"
ACR_NAME="${ACR_NAME:?set ACR_NAME (an existing Azure Container Registry)}"
NAME="${NAME:-repo-wrangler}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DEMO_MODE="${DEMO_MODE:-true}"
KEY_VAULT_NAME="${KEY_VAULT_NAME:-}"
ALLOWED_GITHUB_USERS="${ALLOWED_GITHUB_USERS:-}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ACR_LOGIN_SERVER="$(az acr show -n "$ACR_NAME" --query loginServer -o tsv)"
IMAGE="${ACR_LOGIN_SERVER}/${NAME}-server:${IMAGE_TAG}"

echo "==> Ensuring resource group $RESOURCE_GROUP ($LOCATION)"
az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

echo "==> Building image in ACR: $IMAGE  (from apps/server/Dockerfile)"
# Cloud build — no local Docker daemon required.
az acr build -r "$ACR_NAME" -t "${NAME}-server:${IMAGE_TAG}" \
  -f "$REPO_ROOT/apps/server/Dockerfile" "$REPO_ROOT"

echo "==> Deploying Container App (demoMode=$DEMO_MODE)"
DEPLOY_OUT="$(az deployment group create \
  -g "$RESOURCE_GROUP" \
  -f "$REPO_ROOT/deploy/azure-container-apps/main.bicep" \
  -p name="$NAME" location="$LOCATION" image="$IMAGE" \
     acrLoginServer="$ACR_LOGIN_SERVER" \
     demoMode="$DEMO_MODE" keyVaultName="$KEY_VAULT_NAME" \
     allowedGithubUsers="$ALLOWED_GITHUB_USERS" publicBaseUrl="$PUBLIC_BASE_URL" \
  --query properties.outputs -o json)"

APP_URL="$(echo "$DEPLOY_OUT" | grep -o '"appUrl":[^,}]*' | sed 's/.*"value": *"\(.*\)".*/\1/')"
PRINCIPAL_ID="$(echo "$DEPLOY_OUT" | grep -o '"principalId":[^,}]*' | sed 's/.*"value": *"\(.*\)".*/\1/')"

echo
echo "Deployed: ${APP_URL:-check the portal}"

if [[ "$DEMO_MODE" != "true" && -n "$KEY_VAULT_NAME" ]]; then
  echo "==> Granting the app's managed identity read access to $KEY_VAULT_NAME"
  VAULT_ID="$(az keyvault show -n "$KEY_VAULT_NAME" --query id -o tsv)"
  az role assignment create --assignee "$PRINCIPAL_ID" \
    --role "Key Vault Secrets User" --scope "$VAULT_ID" -o none
  echo "    Done. Restart the app so it picks up the secrets:"
  echo "    az containerapp revision restart -g $RESOURCE_GROUP -n $NAME"
fi
