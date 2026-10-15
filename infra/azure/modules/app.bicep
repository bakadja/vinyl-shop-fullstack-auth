param location string
param name string
param vaultName string
param tags object
param subnetId string
param databaseHost string
param runtimeUser string
param publicOrigin string
param trustedProxyCidrs string
param runtimePasswordSecretName string
param sessionSecretName string
param verificationKeysName string
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  sku: { name: 'B1', tier: 'Basic', capacity: 1 }
  kind: 'linux'
  tags: tags
  properties: { reserved: true }
}
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: { bypass: 'None', defaultAction: 'Deny', virtualNetworkRules: [{ id: subnetId }] }
  }
}
resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  tags: tags
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    virtualNetworkSubnetId: subnetId
    vnetRouteAllEnabled: true
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'node server.js'
      alwaysOn: true
      http20Enabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      healthCheckPath: '/health/ready'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PUBLIC_ORIGIN', value: publicOrigin }
        { name: 'SESSION_PROXY_MODE', value: 'verified-proxy' }
        { name: 'TRUSTED_PROXY_CIDRS', value: trustedProxyCidrs }
        { name: 'PGHOST', value: databaseHost }
        { name: 'PGPORT', value: '5432' }
        { name: 'PGDATABASE', value: 'vinyl_shop' }
        { name: 'DATABASE_SCHEMA', value: 'public' }
        { name: 'PGUSER', value: runtimeUser }
        { name: 'PGSSLMODE', value: 'verify-full' }
        { name: 'PGSSLROOTCERT', value: '/home/site/wwwroot/certificates/azure-postgresql-roots.pem' }
        { name: 'PGPASSWORD', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/${runtimePasswordSecretName})' }
        { name: 'SPIRAL_SESSION_SECRET', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/${sessionSecretName})' }
        { name: 'SPIRAL_SESSION_PREVIOUS_SECRETS', value: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/${verificationKeysName})' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
      ]
    }
  }
}
resource secretsReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, app.id, 'secrets-reader')
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
resource scm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: app
  name: 'scm'
  properties: { allow: false }
}
resource ftp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: app
  name: 'ftp'
  properties: { allow: false }
}
resource logs 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: app
  name: 'logs'
  properties: {
    applicationLogs: { fileSystem: { level: 'Warning' } }
    httpLogs: { fileSystem: { enabled: false, retentionInDays: 7, retentionInMb: 35 } }
    detailedErrorMessages: { enabled: false }
    failedRequestsTracing: { enabled: false }
  }
}
output appId string = app.id
output appName string = app.name
output vaultName string = vault.name
