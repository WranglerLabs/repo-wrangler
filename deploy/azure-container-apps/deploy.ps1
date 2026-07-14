#Requires -Version 7.0
<#
.SYNOPSIS
    Deploy RepoWrangler to Azure Container Apps (PowerShell parity of deploy.sh).

.DESCRIPTION
    Builds the apps/server image in your Azure Container Registry (no local
    Docker needed) and deploys the Container App + Log Analytics via main.bicep.
    Demo mode (SQLite on Azure Files) by default; for production pass -Postgres
    and a Key Vault holding a `database-url` secret.

    You supply every name — nothing is assumed about your environment or naming
    standard. CAF-style per-resource names are supported via main.bicep params.

.EXAMPLE
    # Demo mode (mock data, no secrets):
    ./deploy.ps1 -ResourceGroup rg-repo-wrangler -Location eastus -AcrName myacr

.EXAMPLE
    # Production: PostgreSQL + real mode (after seeding the vault — see README):
    ./deploy.ps1 -ResourceGroup rg-repo-wrangler -Location eastus -AcrName myacr `
        -DemoMode:$false -Postgres -KeyVaultName my-kv `
        -AllowedGithubUsers me -AuthProviders 'entra,github' `
        -PublicBaseUrl https://repo-wrangler.example.com
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $ResourceGroup,
    [Parameter(Mandatory)] [string] $AcrName,
    [string] $Location = 'eastus',
    [string] $Name = 'repo-wrangler',
    [string] $ImageTag = 'latest',
    [bool]   $DemoMode = $true,
    [switch] $Postgres,
    [string] $KeyVaultName = '',
    [string] $AllowedGithubUsers = '',
    [string] $AuthProviders = 'github',
    [string] $PublicBaseUrl = '',
    [string] $ManagedIdentityName = '',
    # Per-resource (CAF) names — override for naming-standard compliance
    # (e.g. -ContainerAppName ca-rw-prod-eus -EnvironmentName cae-rw-prod-eus).
    [string] $ContainerAppName = '',
    [string] $EnvironmentName = '',
    [string] $LogAnalyticsName = '',
    [string] $StorageAccountName = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Postgres -and -not $KeyVaultName) {
    throw '-Postgres requires -KeyVaultName (the vault holding the database-url secret).'
}
if (-not $ManagedIdentityName) { $ManagedIdentityName = "$Name-id" }
if (-not $ContainerAppName)   { $ContainerAppName = $Name }
if (-not $EnvironmentName)    { $EnvironmentName = "$Name-env" }
if (-not $LogAnalyticsName)   { $LogAnalyticsName = "$Name-logs" }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$acrLoginServer = az acr show -n $AcrName --query loginServer -o tsv
if (-not $acrLoginServer) { throw "ACR '$AcrName' not found. Create it: az acr create -n $AcrName -g $ResourceGroup --sku Basic" }
$image = "$acrLoginServer/$Name-server:$ImageTag"

Write-Host "==> Ensuring resource group $ResourceGroup ($Location)"
az group create -n $ResourceGroup -l $Location -o none

Write-Host "==> Building image in ACR: $image (from apps/server/Dockerfile)"
# Cloud build — no local Docker needed. NOTE: on Windows az acr build sometimes
# crashes with a cp1252 UnicodeEncodeError while STREAMING the build log; the
# build itself still runs in ACR. If that happens, verify with:
#   az acr repository show-tags -n <acr> --repository <name>-server
az acr build -r $AcrName -t "$Name-server:$ImageTag" `
    -f (Join-Path $repoRoot 'apps' 'server' 'Dockerfile') $repoRoot
if ($LASTEXITCODE -ne 0) {
    $tag = az acr repository show-tags -n $AcrName --repository "$Name-server" -o tsv 2>$null
    if ($tag -notcontains $ImageTag) { throw 'ACR build failed (image tag not found in registry).' }
    Write-Warning 'az acr build exited non-zero (log-stream bug) but the image IS in the registry — continuing.'
}

# The template pulls images and resolves Key Vault references with a
# user-assigned identity. Create it and grant vault access BEFORE the
# deployment so the FIRST deploy succeeds (secret refs resolve at deploy time).
if ($KeyVaultName) {
    Write-Host "==> Ensuring user-assigned identity $ManagedIdentityName has vault access"
    az identity create -n $ManagedIdentityName -g $ResourceGroup -l $Location -o none
    $miPrincipal = az identity show -n $ManagedIdentityName -g $ResourceGroup --query principalId -o tsv
    $vaultId = az keyvault show -n $KeyVaultName --query id -o tsv
    az role assignment create --assignee-object-id $miPrincipal `
        --assignee-principal-type ServicePrincipal `
        --role 'Key Vault Secrets User' --scope $vaultId -o none 2>$null
}

Write-Host "==> Deploying Container App (demoMode=$DemoMode postgres=$($Postgres.IsPresent))"
$outputs = az deployment group create `
    -g $ResourceGroup `
    -f (Join-Path $repoRoot 'deploy' 'azure-container-apps' 'main.bicep') `
    -p name=$Name location=$Location image=$image `
       acrLoginServer=$acrLoginServer acrName=$AcrName `
       demoMode=$DemoMode postgres=$($Postgres.IsPresent) keyVaultName=$KeyVaultName `
       managedIdentityName=$ManagedIdentityName `
       containerAppName=$ContainerAppName `
       containerAppsEnvironmentName=$EnvironmentName `
       logAnalyticsWorkspaceName=$LogAnalyticsName `
       storageAccountName=$StorageAccountName `
       authProviders=$AuthProviders `
       allowedGithubUsers=$AllowedGithubUsers publicBaseUrl=$PublicBaseUrl `
    --query properties.outputs -o json | ConvertFrom-Json

$appUrl = $outputs.appUrl.value
Write-Host ''
Write-Host "Deployed: $(if ($appUrl) { $appUrl } else { 'check the portal' })"
Write-Host "Validate: curl $appUrl/health/ready"
