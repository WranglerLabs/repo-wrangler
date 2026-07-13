// RepoWrangler — Azure Container Apps deployment.
//
// Runs the apps/server container (the whole product: SPA + API + scheduler) on
// Azure Container Apps, with the SQLite database on a persistent Azure Files
// share and real-mode secrets pulled from Key Vault via managed identity.
//
// This deploys the exact image built from apps/server/Dockerfile — the same
// verified SQLite host that `docker compose up` runs locally. Postgres is a
// later scale option (roadmap PN-1); it is not required here.

@description('Base name for all resources.')
param name string = 'repo-wrangler'

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Full image reference, e.g. <acr>.azurecr.io/repo-wrangler-server:latest')
param image string

@description('Azure Container Registry login server (e.g. myacr.azurecr.io).')
param acrLoginServer string

@description('Key Vault name holding real-mode secrets (empty = demo mode only).')
param keyVaultName string = ''

@description('Run in demo mode (mock data, no secrets).')
param demoMode bool = true

@description('Comma-separated GitHub logins allowed to sign in (first = owner).')
param allowedGithubUsers string = ''

@description('Public URL the instance is reachable at (OAuth callbacks/links).')
param publicBaseUrl string = ''

var storageAccountName = toLower(take('${replace(name, '-', '')}sa${uniqueString(resourceGroup().id)}', 24))
var fileShareName = 'repo-wrangler-data'
var storageMountName = 'rw-data'

// --- Persistent storage for the SQLite database --------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: fileShareName
  properties: {
    accessTier: 'TransactionOptimized'
    shareQuota: 16
  }
}

// --- Log Analytics + Container Apps environment --------------------------------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

// Mount the Azure Files share into the environment so the app can persist SQLite.
resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: env
  name: storageMountName
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: fileShareName
      accessMode: 'ReadWrite'
    }
  }
}

// --- The Container App ----------------------------------------------------------
// Managed identity is used to pull secrets from Key Vault (real mode) and to
// authenticate to ACR without admin credentials.
var kvSecretNames = [
  'github-app-id'
  'github-app-private-key'
  'github-webhook-secret'
  'github-client-id'
  'github-client-secret'
  'session-secret'
]

// Real mode = not demo AND a vault was supplied.
var realMode = !demoMode && !empty(keyVaultName)

// Key Vault reference secrets, resolved by the managed identity at runtime.
var kvSecrets = [for s in kvSecretNames: {
  name: s
  keyVaultUrl: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/${s}'
  identity: 'system'
}]

var baseEnv = [
  { name: 'PORT', value: '8080' }
  { name: 'SQLITE_PATH', value: '/app/data/repo-wrangler.db' }
  { name: 'DEMO_MODE', value: string(demoMode) }
  { name: 'AUTH_MODE', value: 'github_app' }
  { name: 'ALLOWED_GITHUB_USERS', value: allowedGithubUsers }
  { name: 'PUBLIC_BASE_URL', value: publicBaseUrl }
  // Single replica owns the SQLite file and runs the scheduler.
  { name: 'ENABLE_SCHEDULER', value: 'true' }
]

var secretEnv = [
  { name: 'GITHUB_APP_ID', secretRef: 'github-app-id' }
  { name: 'GITHUB_APP_PRIVATE_KEY', secretRef: 'github-app-private-key' }
  { name: 'GITHUB_WEBHOOK_SECRET', secretRef: 'github-webhook-secret' }
  { name: 'GITHUB_CLIENT_ID', secretRef: 'github-client-id' }
  { name: 'GITHUB_CLIENT_SECRET', secretRef: 'github-client-secret' }
  { name: 'SESSION_SECRET', secretRef: 'session-secret' }
]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
      // Real-mode secrets are Key Vault references resolved by the managed
      // identity at runtime; they never appear in the template or logs.
      secrets: realMode ? kvSecrets : []
    }
    template: {
      containers: [
        {
          name: 'server'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: realMode ? concat(baseEnv, secretEnv) : baseEnv
          volumeMounts: [
            { volumeName: storageMountName, mountPath: '/app/data' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 8080 }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 8080 }
              initialDelaySeconds: 10
              periodSeconds: 15
            }
          ]
        }
      ]
      // SQLite is single-writer: pin to exactly one replica. Horizontal scale
      // is the Postgres adapter's job (roadmap PN-1), not this host's.
      scale: { minReplicas: 1, maxReplicas: 1 }
      volumes: [
        {
          name: storageMountName
          storageType: 'AzureFile'
          storageName: storageMountName
        }
      ]
    }
  }
  dependsOn: [ envStorage ]
}

@description('Managed identity principal id. Grant it "Key Vault Secrets User" on your vault for real mode (deploy.sh does this).')
output principalId string = app.identity.principalId
output fqdn string = app.properties.configuration.ingress.fqdn
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
