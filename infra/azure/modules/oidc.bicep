param location string
param name string
param appName string
param tags object
resource app 'Microsoft.Web/sites@2023-12-01' existing = { name: appName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}
resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: identity
  name: 'github-production'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:bakadja/vinyl-shop-fullstack-auth:environment:azure-production'
    audiences: ['api://AzureADTokenExchange']
  }
}
resource deploymentRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(app.id, identity.id, 'app-delivery')
  scope: app
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'de139f84-1756-47ae-9be6-808fbbe84772')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
output clientId string = identity.properties.clientId
