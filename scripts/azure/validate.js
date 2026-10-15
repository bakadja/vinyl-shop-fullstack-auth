import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
const templateError = () => { throw new Error('Unsafe Azure template') }
function resources(template) {
  return (template.resources ?? []).flatMap(resource => [resource, ...(resource.properties?.template ? resources(resource.properties.template) : [])])
}
function validateApplication(app, plan) {
  const settings = Object.fromEntries((app.properties.siteConfig.appSettings ?? []).map(s => [s.name, s.value]))
  if (plan.sku.name !== 'B1' || plan.sku.capacity !== 1 || plan.properties.reserved !== true ||
      app.properties.httpsOnly !== true || app.properties.siteConfig.minTlsVersion !== '1.2' || app.properties.siteConfig.scmMinTlsVersion !== '1.2' ||
      app.properties.siteConfig.linuxFxVersion !== 'NODE|24-lts' || app.properties.siteConfig.ftpsState !== 'Disabled' ||
      app.properties.siteConfig.healthCheckPath !== '/health/ready' || app.properties.clientAffinityEnabled !== false || !app.properties.virtualNetworkSubnetId ||
      app.identity.type !== 'SystemAssigned') templateError()
  for (const [name, value] of Object.entries({ NODE_ENV: 'production', SENTRY_ENVIRONMENT: 'production', PGSSLMODE: 'verify-full', SESSION_PROXY_MODE: 'verified-proxy', PGSSLROOTCERT: '/home/site/wwwroot/certificates/azure-postgresql-roots.pem', SCM_DO_BUILD_DURING_DEPLOYMENT: 'false', WEBSITE_RUN_FROM_PACKAGE: '1' })) {
    if (settings[name] !== value) templateError()
  }
  for (const name of ['PGPASSWORD', 'SPIRAL_SESSION_SECRET', 'SPIRAL_SESSION_PREVIOUS_SECRETS', 'AUTH_ABUSE_HMAC_KEY', 'SENTRY_DSN']) if (!settings[name]?.includes('@Microsoft.KeyVault(SecretUri=')) templateError()
  if (app.properties.siteConfig.appCommandLine !== 'node --import ./instrument.js server.js') templateError()
  if (Object.keys(settings).some(name => name.startsWith('SESSION_COOKIE_') || name === 'SESSION_ROLLING' || name === 'NODE_TLS_REJECT_UNAUTHORIZED')) templateError()
}
function validateDatabase(pg, secure) {
  if (pg.properties.version !== '17' || pg.sku.name !== 'Standard_B1ms' || pg.sku.tier !== 'Burstable' || pg.properties.storage.storageSizeGB !== 32 ||
      pg.properties.storage.autoGrow !== 'Disabled' || pg.properties.network.publicNetworkAccess !== 'Disabled' ||
      !pg.properties.network.delegatedSubnetResourceId || !pg.properties.network.privateDnsZoneArmResourceId || pg.properties.backup.backupRetentionDays < 7 ||
      secure?.properties.value !== 'on') templateError()
}
function validateVault(vault) {
  if (vault.properties.enableRbacAuthorization !== true || vault.properties.enablePurgeProtection !== true ||
      vault.properties.networkAcls.defaultAction !== 'Deny' || vault.properties.networkAcls.bypass !== 'None' || (vault.properties.networkAcls.ipRules ?? []).length !== 0 ||
      vault.properties.networkAcls.virtualNetworkRules.length !== 1) templateError()
}
function validateIdentity(all) {
  const federations = all.filter(r => r.type.toLowerCase() === 'microsoft.managedidentity/userassignedidentities/federatedidentitycredentials')
  const federation = federations[0]?.properties
  if (federations.length !== 1 || federation.issuer !== 'https://token.actions.githubusercontent.com' ||
      federation.subject !== 'repo:bakadja/vinyl-shop-fullstack-auth:environment:azure-production' ||
      federation.audiences?.length !== 1 || federation.audiences[0] !== 'api://AzureADTokenExchange') templateError()
  const assignments = all.filter(r => r.type.toLowerCase() === 'microsoft.authorization/roleassignments')
  const scopes = [['de139f84-1756-47ae-9be6-808fbbe84772', 'Microsoft.Web/sites'], ['4633458b-17de-408a-b874-0445c86b69e6', 'Microsoft.KeyVault/vaults']]
  if (assignments.length !== 2) templateError()
  for (const [role, scope] of scopes) {
    if (!assignments.some(r => r.properties.roleDefinitionId.includes(role) && r.scope?.includes(scope))) templateError()
  }
}
export function validateTemplate(template) {
  const all = resources(template)
  const resource = type => all.find(item => item.type.toLowerCase() === type.toLowerCase())
  const app = resource('Microsoft.Web/sites'), pg = resource('Microsoft.DBforPostgreSQL/flexibleServers')
  const plan = resource('Microsoft.Web/serverfarms'), vault = resource('Microsoft.KeyVault/vaults')
  if (template.parameters?.adminPassword?.type.toLowerCase() !== 'securestring' || !app || !pg || !plan || !vault) templateError()
  validateApplication(app, plan)
  validateDatabase(pg, resource('Microsoft.DBforPostgreSQL/flexibleServers/configurations'))
  validateVault(vault)
  validateIdentity(all)
  const policies = all.filter(r => r.type.toLowerCase() === 'microsoft.web/sites/basicpublishingcredentialspolicies')
  if (policies.length !== 2 || policies.some(r => r.properties.allow !== false)) templateError()
  if (all.some(r => /slots|firewallRules|deploymentScripts/i.test(r.type))) templateError()
}
const workflowError = () => { throw new Error('Unsafe deployment workflow') }
const hasRun = (job, command) => job?.steps?.some(step => step.run === command)
export function validateWorkflow(workflow) {
  if (Object.keys(workflow.on ?? {}).join() !== 'workflow_dispatch' || workflow.permissions?.contents !== 'read' || Object.keys(workflow.permissions).length !== 1) workflowError()
  if (Object.keys(workflow.jobs ?? {}).sort((a, b) => a.localeCompare(b)).join() !== 'build,deploy,preflight') workflowError()
  const { preflight, build, deploy } = workflow.jobs
  if (!hasRun(preflight, 'npm ci --omit=dev --ignore-scripts') || !hasRun(deploy, 'npm ci --omit=dev --ignore-scripts') || !hasRun(preflight, 'node scripts/azure/check-readiness.js') || !hasRun(preflight, 'node scripts/azure/check-github.js') ||
      !build.needs?.includes('preflight') || !deploy.needs?.includes('preflight') || !deploy.needs.includes('build') ||
      deploy.environment !== 'azure-production' || deploy.permissions?.['id-token'] !== 'write' || deploy.permissions?.contents !== 'read' ||
      Object.keys(deploy.permissions).some(key => !['id-token', 'contents', 'actions', 'checks', 'deployments'].includes(key))) workflowError()
  const login = deploy.steps?.findIndex(step => step.uses === 'azure/login@8216e11d8cd9b42fe925c852af8e76311ff067ac')
  const githubCheck = deploy.steps?.findIndex(step => step.run === 'node scripts/azure/check-github.js')
  if (!deploy.steps?.[0]?.uses?.startsWith('actions/checkout@') || githubCheck < 0 || login < githubCheck || !hasRun(deploy, 'node scripts/azure/check-readiness.js')) workflowError()
  if (deploy.steps.some(step => step.uses?.startsWith('azure/webapps-deploy@') && step.with?.['publish-profile'])) workflowError()
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Arguments are not accepted')
    validateWorkflow(parse(await readFile('.github/workflows/azure-deploy.yml', 'utf8')))
    validateTemplate(JSON.parse(await readFile(new URL('../../.cache/azure-template.json', import.meta.url), 'utf8')))
    console.log('Azure compiled template and delivery policy passed; this does not authorize deployment')
  } catch { console.error('Azure artifact validation failed'); process.exitCode = 1 }
}
