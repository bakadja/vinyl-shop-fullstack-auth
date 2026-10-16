@description('Allowed Azure region. PostgreSQL form acceptance was confirmed only for Poland Central.')
@allowed([
  'polandcentral'
  'spaincentral'
  'germanywestcentral'
  'austriaeast'
  'denmarkeast'
])
param location string = 'polandcentral'
param prefix string = 'vinyl'
param suffix string
param vaultName string
param postgresName string
param appDomain string
param sshPublicKey string
@secure()
param administratorPassword string
@description('A public IPv4 address is created only when the owner explicitly enables web ingress in a future reviewed deployment.')
param enablePublicIngress bool = false
@description('Optional single IPv4 address; SSH is allowed only from this address as /32.')
param adminSshAddress string = '127.0.0.1'
param administratorUserName string = 'azureadmin'
param administratorUser string = 'vinyl_migrator'

var tags = {
  project: 'vinyl-shop'
  environment: 'demo'
  budget: 'azure-students'
}
var vmName = '${prefix}-vm-${suffix}'
var vmSubnetId = '${vnet.id}/subnets/vm'
var databaseSubnetId = '${vnet.id}/subnets/database'
var privateDnsZoneName = 'private.postgres.database.azure.com'
var cloudInit = replace(loadTextContent('./cloud-init.yaml'), '__VAULT_NAME__', vaultName)
var domainCloudInit = replace(cloudInit, '__APP_DOMAIN__', appDomain)
var customizedCloudInit = replace(domainCloudInit, '__POSTGRES_HOST__', postgres.properties.fullyQualifiedDomainName)

resource vmNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${vmName}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowCaddyHttps'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        name: 'AllowCaddyHttp'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
        }
      }
      {
        name: 'AllowOwnerSsh'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '${adminSshAddress}/32'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
      {
        name: 'AllowAzureDns'
        properties: {
          priority: 100
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Udp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '168.63.129.16/32'
          destinationPortRange: '53'
        }
      }
      {
        name: 'AllowDatabaseTls'
        properties: {
          priority: 110
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '10.42.0.0/24'
          sourcePortRange: '*'
          destinationAddressPrefix: '10.42.1.0/28'
          destinationPortRange: '5432'
        }
      }
      {
        name: 'AllowInternetHttps'
        properties: {
          priority: 120
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Internet'
          destinationPortRange: '443'
        }
      }
      {
        name: 'AllowInternetHttpForUbuntuMirrors'
        properties: {
          priority: 130
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Internet'
          destinationPortRange: '80'
        }
      }
      {
        name: 'AllowNtp'
        properties: {
          priority: 140
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Udp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Internet'
          destinationPortRange: '123'
        }
      }
      {
        name: 'DenyOtherOutbound'
        properties: {
          priority: 4096
          direction: 'Outbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource databaseNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${vmName}-database-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowVmPostgres'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '10.42.0.0/24'
          sourcePortRange: '*'
          destinationAddressPrefix: '10.42.1.0/28'
          destinationPortRange: '5432'
        }
      }
      {
        name: 'AllowPostgresInSubnet'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '10.42.1.0/28'
          sourcePortRange: '*'
          destinationAddressPrefix: '10.42.1.0/28'
          destinationPortRange: '5432'
        }
      }
      {
        name: 'AllowPostgresStorage'
        properties: {
          priority: 100
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '10.42.1.0/28'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Storage'
          destinationPortRange: '443'
        }
      }
      {
        name: 'AllowPostgresInSubnetOutbound'
        properties: {
          priority: 110
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '10.42.1.0/28'
          sourcePortRange: '*'
          destinationAddressPrefix: '10.42.1.0/28'
          destinationPortRange: '5432'
        }
      }
      {
        name: 'DenyOtherOutbound'
        properties: {
          priority: 4096
          direction: 'Outbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${vmName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/16'] }
    subnets: [
      {
        name: 'vm'
        properties: {
          addressPrefix: '10.42.0.0/24'
          defaultOutboundAccess: false
          networkSecurityGroup: { id: vmNsg.id }
          serviceEndpoints: [{ service: 'Microsoft.KeyVault' }]
        }
      }
      {
        name: 'database'
        properties: {
          addressPrefix: '10.42.1.0/28'
          defaultOutboundAccess: false
          networkSecurityGroup: { id: databaseNsg.id }
          serviceEndpoints: [{ service: 'Microsoft.Storage' }]
          delegations: [{ name: 'postgresql', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
    ]
  }
}

resource privateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: privateDnsZoneName
  location: 'global'
  tags: tags
}
resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: privateDns
  name: '${vmName}-link'
  location: 'global'
  tags: tags
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
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
    networkAcls: { bypass: 'None', defaultAction: 'Deny', ipRules: [], virtualNetworkRules: [{ id: vmSubnetId }] }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  tags: tags
  dependsOn: [dnsLink]
  properties: {
    version: '17'
    administratorLogin: administratorUser
    administratorLoginPassword: administratorPassword
    storage: { storageSizeGB: 32, autoGrow: 'Disabled', type: 'Premium_LRS' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { delegatedSubnetResourceId: databaseSubnetId, privateDnsZoneArmResourceId: privateDns.id, publicNetworkAccess: 'Disabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'vinyl_shop'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource secureTransport 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'require_secure_transport'
  properties: { value: 'on', source: 'user-override' }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = if (enablePublicIngress) {
  name: '${vmName}-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static', publicIPAddressVersion: 'IPv4' }
}
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${vmName}-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [{
      name: 'ipconfig'
      properties: {
        privateIPAllocationMethod: 'Dynamic'
        subnet: { id: vmSubnetId }
        publicIPAddress: enablePublicIngress ? { id: publicIp.id } : null
      }
    }]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: vmName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: 'Standard_B2ats_v2' }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: 'latest' }
      osDisk: {
        name: '${vmName}-os'
        createOption: 'FromImage'
        caching: 'ReadWrite'
        diskSizeGB: 64
        deleteOption: 'Delete'
        managedDisk: { storageAccountType: 'Premium_LRS' }
      }
    }
    osProfile: {
      computerName: vmName
      adminUsername: administratorUserName
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        ssh: { publicKeys: [{ path: '/home/${administratorUserName}/.ssh/authorized_keys', keyData: sshPublicKey }] }
      }
      customData: base64(customizedCloudInit)
    }
    networkProfile: { networkInterfaces: [{ id: nic.id, properties: { primary: true } }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
    securityProfile: { securityType: 'TrustedLaunch', uefiSettings: { secureBootEnabled: true, vTpmEnabled: true } }
  }
}

resource vaultSecretsReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, vm.id, 'secrets-reader')
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output vmName string = vm.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output vaultUri string = vault.properties.vaultUri
output publicIpAddress string = enablePublicIngress ? publicIp!.properties.ipAddress : ''
