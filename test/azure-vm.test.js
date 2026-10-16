import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parse } from 'yaml'
import { validateVmTemplate } from '../scripts/azure/validate.js'

const publicIngress = "[parameters('enablePublicIngress')]"
const adminSsh = "[not(empty(parameters('adminSshAddress')))]"
const databaseSubnetReference = "[variables('databaseSubnetAddressPrefix')]"
function template() {
  const tags = { project: 'vinyl-shop', environment: 'demo', budget: 'azure-students' }
  return {
    parameters: {
      enablePublicIngress: { type: 'bool', defaultValue: false },
      adminSshAddress: { type: 'string', defaultValue: '127.0.0.1' },
      administratorPassword: { type: 'secureString' },
      location: { type: 'string', defaultValue: 'polandcentral', allowedValues: ['polandcentral', 'spaincentral', 'germanywestcentral', 'austriaeast', 'denmarkeast'] }
    },
    variables: { tags, databaseSubnetAddressPrefix: '10.42.1.0/28' },
    resources: [
      { type: 'Microsoft.Network/networkSecurityGroups', name: 'vm-nsg', tags, properties: { securityRules: [
        { name: 'https', properties: { protocol: 'Tcp', sourceAddressPrefix: 'Internet', destinationPortRange: '443', access: 'Allow', direction: 'Inbound', priority: 100 } },
        { name: 'http', properties: { protocol: 'Tcp', sourceAddressPrefix: 'Internet', destinationPortRange: '80', access: 'Allow', direction: 'Inbound', priority: 110 } },
        { name: 'ssh', properties: { protocol: 'Tcp', sourceAddressPrefix: "[format('{0}/32', parameters('adminSshAddress'))]", destinationPortRange: '22', access: 'Allow', direction: 'Inbound', priority: 120 } },
        { name: 'dns', properties: { protocol: 'Udp', sourceAddressPrefix: '*', destinationAddressPrefix: '168.63.129.16/32', destinationPortRange: '53', access: 'Allow', direction: 'Outbound', priority: 100 } },
        { name: 'database', properties: { protocol: 'Tcp', sourceAddressPrefix: '10.42.0.0/24', destinationAddressPrefix: databaseSubnetReference, destinationPortRange: '5432', access: 'Allow', direction: 'Outbound', priority: 110 } },
        { name: 'https-egress', properties: { protocol: 'Tcp', sourceAddressPrefix: '*', destinationAddressPrefix: 'Internet', destinationPortRange: '443', access: 'Allow', direction: 'Outbound', priority: 120 } },
        { name: 'http-egress', properties: { protocol: 'Tcp', sourceAddressPrefix: '*', destinationAddressPrefix: 'Internet', destinationPortRange: '80', access: 'Allow', direction: 'Outbound', priority: 130 } },
        { name: 'ntp', properties: { protocol: 'Udp', sourceAddressPrefix: '*', destinationAddressPrefix: 'Internet', destinationPortRange: '123', access: 'Allow', direction: 'Outbound', priority: 140 } },
        { name: 'deny-egress', properties: { protocol: '*', sourceAddressPrefix: '*', destinationAddressPrefix: '*', destinationPortRange: '*', access: 'Deny', direction: 'Outbound', priority: 4096 } }
      ] } },
      { type: 'Microsoft.Network/networkSecurityGroups', name: 'database-nsg', tags, properties: { securityRules: [
        { name: 'vm-postgres', properties: { protocol: 'Tcp', sourceAddressPrefix: '10.42.0.0/24', destinationAddressPrefix: databaseSubnetReference, destinationPortRange: '5432', access: 'Allow', direction: 'Inbound', priority: 100 } },
        { name: 'pg-subnet', properties: { protocol: 'Tcp', sourceAddressPrefix: databaseSubnetReference, destinationAddressPrefix: databaseSubnetReference, destinationPortRange: '5432', access: 'Allow', direction: 'Inbound', priority: 110 } },
        { name: 'storage', properties: { protocol: 'Tcp', sourceAddressPrefix: databaseSubnetReference, destinationAddressPrefix: 'Storage', destinationPortRange: '443', access: 'Allow', direction: 'Outbound', priority: 100 } },
        { name: 'pg-out', properties: { protocol: 'Tcp', sourceAddressPrefix: databaseSubnetReference, destinationAddressPrefix: databaseSubnetReference, destinationPortRange: '5432', access: 'Allow', direction: 'Outbound', priority: 110 } },
        { name: 'deny-egress', properties: { protocol: '*', sourceAddressPrefix: '*', destinationAddressPrefix: '*', destinationPortRange: '*', access: 'Deny', direction: 'Outbound', priority: 4096 } }
      ] } },
      { type: 'Microsoft.Network/virtualNetworks', name: 'vm-vnet', tags, properties: { subnets: [
        { name: 'vm', properties: { addressPrefix: '10.42.0.0/24', networkSecurityGroup: { id: 'vm-nsg' }, serviceEndpoints: [{ service: 'Microsoft.KeyVault' }] } },
        { name: 'database', properties: { addressPrefix: databaseSubnetReference, delegations: [{ properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }] } }
      ] } },
      { type: 'Microsoft.Network/publicIPAddresses', name: 'public-ip', condition: publicIngress, tags, sku: { name: 'Standard' }, properties: { publicIPAllocationMethod: 'Static' } },
      { type: 'Microsoft.Compute/virtualMachines', name: 'vm', tags, identity: { type: 'SystemAssigned' }, properties: {
        hardwareProfile: { vmSize: 'Standard_B2ats_v2' },
        storageProfile: { imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts' }, osDisk: { diskSizeGB: 64, deleteOption: 'Delete', managedDisk: { storageAccountType: 'Premium_LRS' } } },
        osProfile: { linuxConfiguration: { disablePasswordAuthentication: true, ssh: { publicKeys: [{ keyData: 'ssh-rsa AAAA example', path: '/home/operator/.ssh/authorized_keys' }] } }, customData: '[base64(cloud-init)]' },
        diagnosticsProfile: { bootDiagnostics: { enabled: true } },
        securityProfile: { securityType: 'TrustedLaunch', encryptionAtHost: true, uefiSettings: { secureBootEnabled: true, vTpmEnabled: true } },
        networkProfile: { networkInterfaces: [{ id: '/networkInterfaces/vm-nic', properties: { primary: true, deleteOption: 'Delete' } }] }
      } },
      { type: 'Microsoft.Network/networkInterfaces', name: 'vm-nic', tags, properties: { ipConfigurations: [{ properties: { publicIPAddress: "[if(parameters('enablePublicIngress'), createObject('id', resourceId('Microsoft.Network/publicIPAddresses', 'vm-ip'), 'properties', createObject('deleteOption', 'Delete')), null())]", subnet: { id: 'vm-subnet' } } }] } },
      { type: 'Microsoft.Network/privateDnsZones', name: 'private.postgres.database.azure.com', tags, properties: {} },
      { type: 'Microsoft.Network/privateDnsZones/virtualNetworkLinks', name: 'database-link', tags, properties: { registrationEnabled: false, virtualNetwork: { id: 'vm-vnet' } } },
      { type: 'Microsoft.DBforPostgreSQL/flexibleServers', name: 'postgres', tags, identity: { type: 'SystemAssigned' }, sku: { name: 'Standard_B1ms', tier: 'Burstable' }, properties: {
        version: '17', storage: { storageSizeGB: 32, autoGrow: 'Disabled', type: 'Premium_LRS' },
        backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }, highAvailability: { mode: 'Disabled' },
        network: { publicNetworkAccess: 'Disabled', delegatedSubnetResourceId: 'database-subnet', privateDnsZoneArmResourceId: 'database-zone' }
      } },
      { type: 'Microsoft.DBforPostgreSQL/flexibleServers/configurations', name: 'require_secure_transport', properties: { value: 'on' } },
      { type: 'Microsoft.KeyVault/vaults', id: 'vault', name: 'vault', tags, properties: { enableRbacAuthorization: true, enablePurgeProtection: true, networkAcls: { defaultAction: 'Deny', bypass: 'None', ipRules: [], virtualNetworkRules: [{ id: 'vm-subnet' }] } } },
      { type: 'Microsoft.Authorization/roleAssignments', name: 'vm-vault-reader', scope: 'vault', properties: { roleDefinitionId: '4633458b-17de-408a-b874-0445c86b69e6', principalId: '[reference(vm).identity.principalId]' } }
    ]
  }
}

test('VM candidate keeps secure defaults and required services', () => {
  assert.doesNotThrow(() => validateVmTemplate(template()))
})

test('VM candidate rejects public database, broad SSH, unbudgeted ingress, and expensive drift', () => {
  const changes = [
    t => t.resources[8].properties.network.publicNetworkAccess = 'Enabled',
    t => delete t.resources[8].identity,
    t => t.resources[0].properties.securityRules[2].properties.sourceAddressPrefix = '*',
    t => t.resources[0].properties.securityRules[0].properties.destinationPortRange = '*',
    t => t.resources[4].properties.hardwareProfile.vmSize = 'Standard_B2ms',
    t => t.resources[4].properties.storageProfile.osDisk.diskSizeGB = 128,
    t => t.resources[10].properties.enableRbacAuthorization = false,
    t => t.parameters.enablePublicIngress.defaultValue = true,
    t => t.variables.databaseSubnetAddressPrefix = '10.42.0.0/24',
    t => delete t.parameters.location.allowedValues,
    t => t.resources[10].properties.networkAcls.ipRules = ['0.0.0.0'],
    t => t.resources[0].properties.securityRules[8].properties.access = 'Allow',
    t => t.resources[1].properties.securityRules[0].properties.sourceAddressPrefix = 'Internet'
  ]
  for (const change of changes) {
    const candidate = template(); change(candidate)
    assert.throws(() => validateVmTemplate(candidate), /Unsafe Azure VM template/)
  }
})

test('VM deletion removes its OS disk, NIC, and conditional public IP', () => {
  assert.doesNotThrow(() => validateVmTemplate(template()))
  const changes = [
    t => t.resources[4].properties.storageProfile.osDisk.deleteOption = 'Detach',
    t => t.resources[4].properties.networkProfile.networkInterfaces[0].properties.deleteOption = 'Detach',
    t => t.resources[5].properties.ipConfigurations[0].properties.publicIPAddress = t.resources[5].properties.ipConfigurations[0].properties.publicIPAddress.replace("createObject('deleteOption', 'Delete')", "createObject('deleteOption', 'Detach')")
  ]
  for (const change of changes) {
    const candidate = template(); change(candidate)
    assert.throws(() => validateVmTemplate(candidate), /Unsafe Azure VM template/)
  }
})

test('cloud-init keeps secrets in Key Vault and binds Express behind local Caddy', async () => {
  const path = new URL('../infra/azure/vm/cloud-init.yaml', import.meta.url)
  const source = await readFile(path, 'utf8')
  const cloudInit = parse(source)
  const files = Object.fromEntries(cloudInit.write_files.map(file => [file.path, file.content]))
  const service = files['/etc/systemd/system/vinyl-shop.service']
  const caddy = files['/opt/vinyl-shop/Caddyfile']
  const secretFetcher = files['/usr/local/sbin/fetch-vinyl-secrets']
  assert.ok(cloudInit.bootcmd.some(command => command.join(' ').includes('/opt/vinyl-shop')))
  assert.match(service, /APP_BIND_ADDRESS=127\.0\.0\.1/)
  assert.match(service, /TRUSTED_PROXY_CIDRS=127\.0\.0\.1\/32/)
  assert.match(service, /PGHOST=__POSTGRES_HOST__/)
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8000/)
  for (const secret of ['runtime-db-password', 'session-signing-key', 'session-verification-keys', 'auth-abuse-hmac-key', 'sentry-dsn']) assert.ok(secretFetcher.includes(secret))
  assert.match(secretFetcher, /grp\.getgrnam\('vinyl'\)\.gr_gid/)
  assert.doesNotMatch(source, /__NODESOURCE_KEY__|__CADDY_KEY__/)
})
