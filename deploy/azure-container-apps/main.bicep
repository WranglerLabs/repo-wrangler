// RepoWrangler — Azure Container Apps deployment.
//
// Runs the apps/server container (the whole product: SPA + API + scheduler) on
// Azure Container Apps. Two database modes:
//
//   postgres = true   (RECOMMENDED for production) — the app connects to
//                     PostgreSQL via a `database-url` secret in Key Vault.
//                     No file share; no SQLite locking issues.
//   postgres = false  (default, demo/evaluation) — SQLite on an Azure Files
//                     share mounted at /app/data. SQLite file locking over
//                     SMB is unreliable under restarts/crashes; do NOT use
//                     this mode for a production instance.
//
// Key Vault reads use a USER-ASSIGNED managed identity. Private ACR image
// pulls can use the same identity; a public digest-pinned image (including the
// immutable GHCR release consumed by Ranch Hand) needs no registry credential.

@description('Base name for all resources.')
param name string = 'repo-wrangler'

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Full image reference. Ranch Hand requires a sha256 digest; manual deployments may supply an explicit version tag.')
param image string

@description('Optional Azure Container Registry login server (e.g. myacr.azurecr.io). Empty for a public digest-pinned image such as GHCR.')
param acrLoginServer string = ''

@description('ACR resource name. Required only with acrLoginServer and must be in this resource group for the in-template AcrPull grant.')
param acrName string = empty(acrLoginServer) ? 'unused' : split(acrLoginServer, '.')[0]

@description('Key Vault name holding secrets (real mode and/or postgres). Empty = demo mode on SQLite only.')
param keyVaultName string = ''

@description('Run in demo mode (mock data, no provider secrets).')
param demoMode bool = true

@description('Use PostgreSQL via a database-url secret in Key Vault (production). Requires keyVaultName. False = SQLite on Azure Files (demo/evaluation only).')
param postgres bool = false

@description('Provision a dedicated Azure Database for PostgreSQL flexible server for this deployment.')
param provisionPostgres bool = false

@description('Globally unique PostgreSQL flexible-server name. Required when provisionPostgres is true.')
param postgresServerName string = ''

@description('PostgreSQL administrator login used only for the dedicated server.')
param postgresAdminUser string = 'repowrangleradmin'

@secure()
@description('Generated PostgreSQL administrator password. Never emitted as an output.')
param postgresAdminPassword string = ''

@secure()
@description('Optional external PostgreSQL URL. Ignored when provisionPostgres is true.')
param databaseUrl string = ''

@secure()
@description('RepoWrangler session-signing secret for real mode.')
param sessionSecret string = ''

@secure()
@description('RepoWrangler stored-credential encryption key for real mode.')
param secretEncryptionKey string = ''

@secure()
@description('One-time first-run setup token for a public real-mode endpoint.')
param setupToken string = ''

@description('Comma-separated GitHub logins allowed to sign in (first = owner).')
param allowedGithubUsers string = ''

@description('Enabled sign-in providers (PN-5), ordered CSV of github,gitlab,entra,google,local.')
param authProviders string = 'github'

@description('Public URL the instance is reachable at (OAuth callbacks/links).')
param publicBaseUrl string = ''

@description('Run the in-process scheduler. Disable on a staging revision before traffic cutover.')
param enableScheduler bool = true

@description('Optional custom hostname to preserve on repeat deployments. Pair with customDomainCertificateName.')
param customDomainName string = ''

@description('Optional managed certificate name in this Container Apps environment. Pair with customDomainName.')
param customDomainCertificateName string = ''

// --- Per-resource names (CAF-friendly) ----------------------------------------
// Each defaults to the original derived value, so existing deployments are
// unchanged. Cloud Adoption Framework callers pass explicit, prefix-correct
// names per resource type (ca-, cae-, log-, id-, st).
@description('Container App name (CAF: ca-<workload>-<env>-<region>). Default: the base name.')
param containerAppName string = name

@description('Container Apps managed environment name (CAF: cae-<workload>-<env>-<region>). Default: <name>-env.')
param containerAppsEnvironmentName string = '${name}-env'

@description('Log Analytics workspace name (CAF: log-<workload>-<env>-<region>). Default: <name>-logs.')
param logAnalyticsWorkspaceName string = '${name}-logs'

@description('User-assigned managed identity name (CAF: id-<workload>-<env>-<region>). Default: <name>-id.')
param managedIdentityName string = '${name}-id'

@description('Storage account name for SQLite mode (CAF: st<workload><env><region>). 3-24 lowercase alphanumerics, globally unique. Empty = auto-generated. Unused when postgres = true.')
param storageAccountName string = ''

var effectiveStorageAccountName = empty(storageAccountName) ? toLower(take('${replace(name, '-', '')}sa${uniqueString(resourceGroup().id)}', 24)) : storageAccountName
var fileShareName = 'repo-wrangler-data'
var storageMountName = 'rw-data'
var sqliteMode = !postgres
var privateRegistry = !empty(acrLoginServer)
var provisionedDatabaseName = 'repo_wrangler'

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = if (provisionPostgres) {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    version: '16'
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = if (provisionPostgres) {
  parent: postgresServer
  name: provisionedDatabaseName
  properties: {}
}

resource postgresAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (provisionPostgres) {
  parent: postgresServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// --- Identity: created first so it can be granted AcrPull BEFORE the app pulls --
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: managedIdentityName
  location: location
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = if (privateRegistry) {
  name: acrName
}

// AcrPull (7f951dda-4ed3-4680-a7ca-43fe172d538d). Without this grant the app
// can never pull its image ("ACR token exchange endpoint returned error 401").
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (privateRegistry) {
  name: guid(acr.id, uami.id, 'acrpull')
  scope: acr
  properties: {
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

// --- Persistent storage for SQLite mode only -----------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (sqliteMode) {
  name: effectiveStorageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = if (sqliteMode) {
  parent: storage
  name: 'default'
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = if (sqliteMode) {
  parent: fileService
  name: fileShareName
  properties: {
    accessTier: 'TransactionOptimized'
    shareQuota: 16
  }
}

// --- Log Analytics + Container Apps environment --------------------------------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
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

// Mount the Azure Files share into the environment (SQLite mode only).
resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = if (sqliteMode) {
  parent: env
  name: storageMountName
  properties: {
    azureFile: {
      accountName: sqliteMode ? storage.name : ''
      accountKey: sqliteMode ? storage!.listKeys().keys[0].value : ''
      shareName: fileShareName
      accessMode: 'ReadWrite'
    }
  }
}

// --- Secrets ---------------------------------------------------------------------
var kvSecretNames = [
  'session-secret'
  'secret-encryption-key'
  'setup-token'
]

var realMode = !demoMode
var useKeyVault = realMode && !empty(keyVaultName)

// Key Vault reference secrets, resolved by the user-assigned identity at runtime.
var kvSecrets = [for s in kvSecretNames: {
  name: s
  keyVaultUrl: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/${s}'
  identity: uami.id
}]

var directRuntimeSecrets = [
  { name: 'session-secret', value: sessionSecret }
  { name: 'secret-encryption-key', value: secretEncryptionKey }
  { name: 'setup-token', value: setupToken }
]

// PostgreSQL connection string, also a Key Vault reference (postgres mode).
var dbSecret = [{
  name: 'database-url'
  keyVaultUrl: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/database-url'
  identity: uami.id
}]

var provisionedDatabaseUrl = provisionPostgres ? 'postgresql://${postgresAdminUser}:${uriComponent(postgresAdminPassword)}@${postgresServerName}.postgres.database.azure.com:5432/${provisionedDatabaseName}?sslmode=require' : databaseUrl
var directDatabaseSecret = [{ name: 'database-url', value: provisionedDatabaseUrl }]

var baseEnv = [
  { name: 'PORT', value: '8080' }
  { name: 'DEMO_MODE', value: string(demoMode) }
  // Sign-in providers (PN-5). AUTH_MODE stays as the legacy fallback.
  { name: 'AUTH_PROVIDERS', value: authProviders }
  { name: 'AUTH_MODE', value: 'github_app' }
  { name: 'ALLOWED_GITHUB_USERS', value: allowedGithubUsers }
  { name: 'PUBLIC_BASE_URL', value: publicBaseUrl }
  // One replica owns the scheduler (and the SQLite file in sqlite mode).
  { name: 'ENABLE_SCHEDULER', value: enableScheduler ? 'true' : 'false' }
]

var sqliteEnv = [
  { name: 'SQLITE_PATH', value: '/app/data/repo-wrangler.db' }
]

var postgresEnv = [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
]

var secretEnv = [
  { name: 'SESSION_SECRET', secretRef: 'session-secret' }
  { name: 'SECRET_ENCRYPTION_KEY', secretRef: 'secret-encryption-key' }
  { name: 'SETUP_TOKEN', secretRef: 'setup-token' }
]

var appEnv = concat(
  baseEnv,
  sqliteMode ? sqliteEnv : postgresEnv,
  realMode ? secretEnv : []
)

var customDomainConfigured = !empty(customDomainName) && !empty(customDomainCertificateName)
var appIngress = union({
  external: true
  targetPort: 8080
  transport: 'auto'
  allowInsecure: false
}, customDomainConfigured ? {
  customDomains: [
    {
      name: customDomainName
      bindingType: 'SniEnabled'
      certificateId: resourceId('Microsoft.App/managedEnvironments/managedCertificates', containerAppsEnvironmentName, customDomainCertificateName)
    }
  ]
} : {})

var appSecrets = concat(
  realMode ? (useKeyVault ? kvSecrets : directRuntimeSecrets) : [],
  postgres ? (useKeyVault && !provisionPostgres && empty(databaseUrl) ? dbSecret : directDatabaseSecret) : []
)

// --- The Container App ----------------------------------------------------------
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: appIngress
      registries: privateRegistry ? [
        {
          server: acrLoginServer
          identity: uami.id
        }
      ] : []
      // Secrets are Key Vault references resolved by the user-assigned identity
      // at runtime; they never appear in the template or logs. The deploy script
      // grants that identity "Key Vault Secrets User" on your vault BEFORE this
      // template is applied, so first-deploy secret resolution succeeds.
      secrets: appSecrets
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
          env: appEnv
          volumeMounts: sqliteMode ? [
            { volumeName: storageMountName, mountPath: '/app/data' }
          ] : []
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 8080 }
              // The server listens only after boot migrations complete; give
              // slow first-boot migrations room before liveness can kill it.
              initialDelaySeconds: 30
              periodSeconds: 30
              failureThreshold: 5
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
      // SQLite is single-writer; the scheduler must run on exactly one replica.
      // Keep 1/1 in both modes (scale-out on Postgres = add replicas with
      // ENABLE_SCHEDULER=false — see https://wranglerlabs.org/deployment).
      scale: { minReplicas: 1, maxReplicas: 1 }
      volumes: sqliteMode ? [
        {
          name: storageMountName
          storageType: 'AzureFile'
          storageName: storageMountName
        }
      ] : []
    }
  }
  dependsOn: [ envStorage, acrPull, postgresDatabase, postgresAzureServices ]
}

@description('User-assigned identity principal id. The deploy script grants it "Key Vault Secrets User" on your vault.')
output principalId string = uami.properties.principalId
output identityResourceId string = uami.id
output fqdn string = app.properties.configuration.ingress.fqdn
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
