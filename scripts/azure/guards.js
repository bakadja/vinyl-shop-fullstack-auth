import { randomBytes } from 'node:crypto'
import { sessionConfig } from '../../sessions/config.js'
const blocked = () => { throw new Error('Deployment blocked: required security or operational evidence is missing') }
const gateNames = ['proxy', 'abuseProtection', 'subscriptionQuotas', 'costApproval', 'bootstrap', 'restoreDrill']
function evidenceURL(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && !url.search && !url.hash &&
      /^\/bakadja\/vinyl-shop-fullstack-auth\/(pull|issues)\/[1-9]\d*$/.test(url.pathname)
  } catch { return false }
}
export function assertReadiness(manifest) {
  if (manifest?.deploymentEnabled !== true || !manifest.gates || Object.keys(manifest.gates).length !== gateNames.length) blocked()
  for (const name of gateNames) {
    const gate = manifest.gates[name]
    if (gate?.status !== 'verified' || !Array.isArray(gate.evidence) || !gate.evidence.length || !gate.evidence.every(evidenceURL)) blocked()
  }
}
export function assertGitHubDeployment(snapshot) {
  if (snapshot?.repository !== 'bakadja/vinyl-shop-fullstack-auth' || snapshot.ref !== 'refs/heads/main' ||
      !/^[0-9a-f]{40}$/.test(snapshot.sha ?? '') || snapshot.sha !== snapshot.mainSha) blocked()
  const environment = snapshot.environment
  const policy = environment?.deployment_branch_policy
  if (environment?.name !== 'azure-production' || environment.can_admins_bypass !== false || !policy?.custom_branch_policies || policy.protected_branches !== false ||
      !environment.protection_rules?.some(rule => rule.type === 'required_reviewers' && rule.reviewers?.length > 0) ||
      snapshot.branches?.length !== 1 || snapshot.branches[0].name !== 'main' || snapshot.branches[0].type !== 'branch') blocked()
  // The caller fetches newest-first; never fall back to a previous successful run after a failed rerun.
  for (const [name, path] of [['API tests', '.github/workflows/api-tests.yml'], ['Azure readiness validation', '.github/workflows/azure-validate.yml']]) {
    const run = snapshot.runs?.find(item => item.name === name && item.head_sha === snapshot.sha && item.event === 'push' && item.path === path)
    if (run?.status !== 'completed' || run.conclusion !== 'success') blocked()
  }
  const sonar = snapshot.checks?.find(item => item.name === 'SonarCloud Code Analysis' && item.head_sha === snapshot.sha && item.app?.slug === 'sonarcloud')
  if (sonar?.status !== 'completed' || sonar.conclusion !== 'success') blocked()
}

export function assertConfiguration(config) {
  try {
    if (!/^[a-z][a-z0-9-]{1,5}[a-z0-9]$/.test(config?.prefix ?? '') || !/^[a-z]{3,30}$/.test(config.location ?? '')) throw new Error('Invalid names')
    for (const role of [config.runtimeUser, config.adminUser]) {
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(role ?? '') || /^(pg_|azure_)/.test(role) || ['postgres', 'public'].includes(role)) throw new Error('Invalid roles')
    }
    if (config.runtimeUser === config.adminUser) throw new Error('Shared credentials')
    sessionConfig({ NODE_ENV: 'production', SESSION_PROXY_MODE: 'verified-proxy', PUBLIC_ORIGIN: config.publicOrigin,
      TRUSTED_PROXY_CIDRS: config.trustedProxyCidrs, SPIRAL_SESSION_SECRET: randomBytes(32).toString('hex') })
  } catch { throw new Error('Invalid Azure configuration') }
}
