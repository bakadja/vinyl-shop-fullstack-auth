targetScope = 'resourceGroup'

@description('Choose only after checking subscription policy, quotas and regional pricing.')
param location string = resourceGroup().location
@minLength(3)
@maxLength(7)
param prefix string
@description('Canonical HTTPS origin; must match the actual public browser origin.')
param publicOrigin string
@description('Required evidence-backed immediate proxy CIDRs. No default or inferred Azure IP ranges.')
@minLength(1)
param trustedProxyCidrs string
@description('Existing Key Vault secret name containing the runtime DB password, not the admin password.')
param runtimePasswordSecretName string = 'runtime-db-password'
param sessionSecretName string = 'session-signing-key'
param verificationKeysName string = 'session-verification-keys'
param runtimeUser string = 'vinyl_runtime'
param adminUser string = 'vinyl_migrator'
@secure()
@description('Supplied externally using a Key Vault ARM parameter reference. Never commit a value.')
param adminPassword string
@description('Optional existing action group. No email addresses are stored in this template.')
param actionGroupResourceId string = ''

var suffix = uniqueString(resourceGroup().id)
var tags = { project: 'vinyl-shop', purpose: 'student-demo' }
module network './modules/network.bicep' = {
  name: 'network'
  params: { location: location, name: '${prefix}-vnet', tags: tags }
}
module database './modules/database.bicep' = {
  name: 'database'
  params: {
    location: location
    name: '${prefix}-pg-${suffix}'
    tags: tags
    subnetId: network.outputs.databaseSubnetId
    privateDnsZoneId: network.outputs.privateDnsZoneId
    adminUser: adminUser
    adminPassword: adminPassword
  }
}
module app './modules/app.bicep' = {
  name: 'app'
  params: {
    location: location
    name: '${prefix}-app-${suffix}'
    vaultName: '${prefix}-kv-${suffix}'
    tags: tags
    subnetId: network.outputs.appSubnetId
    databaseHost: database.outputs.host
    runtimeUser: runtimeUser
    publicOrigin: publicOrigin
    trustedProxyCidrs: trustedProxyCidrs
    runtimePasswordSecretName: runtimePasswordSecretName
    sessionSecretName: sessionSecretName
    verificationKeysName: verificationKeysName
  }
}
module deliveryIdentity './modules/oidc.bicep' = {
  name: 'delivery-identity'
  params: { location: location, name: '${prefix}-delivery-${suffix}', appName: app.outputs.appName, tags: tags }
}
module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { appId: app.outputs.appId, databaseId: database.outputs.databaseId, actionGroupResourceId: actionGroupResourceId, tags: tags }
}
output appName string = app.outputs.appName
output vaultName string = app.outputs.vaultName
output databaseHost string = database.outputs.host
output deploymentClientId string = deliveryIdentity.outputs.clientId
