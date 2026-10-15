param location string
param name string
param tags object
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/16'] }
    subnets: [
      { name: 'app', properties: { addressPrefix: '10.42.0.0/26', serviceEndpoints: [{ service: 'Microsoft.KeyVault' }], delegations: [{ name: 'app-service', properties: { serviceName: 'Microsoft.Web/serverFarms' } }] } }
      { name: 'database', properties: { addressPrefix: '10.42.1.0/28', delegations: [{ name: 'postgresql', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }] } }
    ]
  }
}
resource dns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}
resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dns
  name: name
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}
output appSubnetId string = '${vnet.id}/subnets/app'
output databaseSubnetId string = '${vnet.id}/subnets/database'
output privateDnsZoneId string = dns.id
