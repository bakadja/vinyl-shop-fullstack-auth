import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { readGitHubSnapshot } from '../scripts/azure/check-github.js'
import { assertReadiness, assertGitHubDeployment, assertConfiguration } from '../scripts/azure/guards.js'
const sha = 'a'.repeat(40)
const gateNames = ['proxy', 'abuseProtection', 'subscriptionQuotas', 'costApproval', 'bootstrap', 'restoreDrill']
const ready = () => ({ deploymentEnabled: true, gates: Object.fromEntries(gateNames.map(name => [name, { status: 'verified', evidence: ['https://github.com/bakadja/vinyl-shop-fullstack-auth/issues/123'] }])) })
const snapshot = () => ({ repository: 'bakadja/vinyl-shop-fullstack-auth', ref: 'refs/heads/main', sha, mainSha: sha,
  environment: { name: 'azure-production', can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'reviewer' } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
  branches: [{ name: 'main', type: 'branch' }], runs: [{ name: 'API tests', head_sha: sha, event: 'push', status: 'completed', conclusion: 'success', path: '.github/workflows/api-tests.yml' }, { name: 'Azure readiness validation', head_sha: sha, event: 'push', status: 'completed', conclusion: 'success', path: '.github/workflows/azure-validate.yml' }],
  checks: [{ name: 'SonarCloud Code Analysis', head_sha: sha, status: 'completed', conclusion: 'success', app: { slug: 'sonarcloud' } }] })

test('the committed manifest blocks deployment; all six independent evidence gates are mandatory', async () => {
  const manifest = JSON.parse(await readFile(new URL('../infra/azure/readiness.json', import.meta.url), 'utf8'))
  assert.throws(() => assertReadiness(manifest), /Deployment blocked/)
  assert.doesNotThrow(() => assertReadiness(ready()))
  for (const name of gateNames) {
    for (const change of [m => delete m.gates[name], m => m.gates[name].status = 'blocked', m => m.gates[name].evidence = []]) {
      const m = ready(); change(m); assert.throws(() => assertReadiness(m), /Deployment blocked/)
    }
  }
  for (const m of [null, {}, { ...ready(), deploymentEnabled: 'true' }]) assert.throws(() => assertReadiness(m), /Deployment blocked/)
})

test('readiness rejects arbitrary or credential-bearing evidence URLs', () => {
  for (const evidence of ['http://github.com/bakadja/vinyl-shop-fullstack-auth/issues/1', 'https://example.com/evidence', 'https://user:password@github.com/bakadja/vinyl-shop-fullstack-auth/issues/1', 'https://github.com/bakadja/vinyl-shop-fullstack-auth/issues/1?token=value']) {
    const m = ready(); m.gates.proxy.evidence = [evidence]; assert.throws(() => assertReadiness(m), /Deployment blocked/)
  }
})

test('GitHub deployment guard requires main, successful exact-commit CI/Sonar and enforced manual reviewers', () => {
  assert.doesNotThrow(() => assertGitHubDeployment(snapshot()))
  const changes = [s => s.repository = 'other/repo', s => s.ref = 'refs/heads/topic', s => s.mainSha = 'b'.repeat(40),
    s => s.environment.can_admins_bypass = true, s => s.environment.protection_rules = [],
    s => s.environment.protection_rules[0].reviewers = [], s => s.environment.deployment_branch_policy = null,
    s => s.branches.push({ name: '*', type: 'branch' }), s => s.branches[0].type = 'tag',
    s => s.runs[0].head_sha = 'b'.repeat(40), s => s.runs[0].conclusion = 'failure', s => s.runs[0].event = 'pull_request',
    s => s.runs[0].path = '.github/workflows/other.yml', s => s.runs.pop(), s => s.runs[1].conclusion = 'failure', s => s.runs[1].head_sha = 'b'.repeat(40), s => s.checks[0].conclusion = 'failure',
    s => s.checks[0].head_sha = 'b'.repeat(40), s => s.checks[0].app.slug = 'untrusted']
  for (const change of changes) { const s = snapshot(); change(s); assert.throws(() => assertGitHubDeployment(s), /Deployment blocked/) }
})

test('Azure configuration rejects insecure origins, broad proxy ranges and invalid or overlapping role names', () => {
  const config = { prefix: 'vinyl', location: 'westeurope', publicOrigin: 'https://shop.example', trustedProxyCidrs: '127.0.0.1/32', runtimeUser: 'vinyl_runtime', adminUser: 'vinyl_migrator' }
  assert.doesNotThrow(() => assertConfiguration(config))
  for (const change of [c => c.prefix = 'too-long-for-vault', c => c.location = '', c => c.publicOrigin = 'http://shop.example',
    c => c.publicOrigin = 'https://shop.example/path', c => c.trustedProxyCidrs = '0.0.0.0/0', c => c.trustedProxyCidrs = '10.0.0.0/8',
    c => c.trustedProxyCidrs = '', c => c.runtimeUser = c.adminUser, c => c.runtimeUser = 'admin;DROP', c => c.adminUser = 'postgres']) {
    const c = { ...config }; change(c); assert.throws(() => assertConfiguration(c), /Invalid Azure configuration/)
  }
})

test('readiness CLI fails with the expected closed-gate diagnostic rather than a loader or parsing error', () => {
  const result = spawnSync(process.execPath, [new URL('../scripts/azure/check-readiness.js', import.meta.url).pathname], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.trim(), 'Deployment blocked. See infra/azure/readiness.json and docs/azure-deployment.md.')
})

test('GitHub evidence loader uses fixed repository API paths and rejects untrusted context before requests', async () => {
  const s = snapshot(), base = 'repos/bakadja/vinyl-shop-fullstack-auth'
  const responses = {
    [`${base}/git/ref/heads/main`]: { object: { sha } },
    [`${base}/environments/azure-production`]: s.environment,
    [`${base}/environments/azure-production/deployment-branch-policies`]: { branch_policies: s.branches },
    [`${base}/actions/runs?head_sha=${sha}&event=push&per_page=100`]: { workflow_runs: s.runs },
    [`${base}/commits/${sha}/check-runs?per_page=100`]: { check_runs: s.checks }
  }
  const requested = []
  const loaded = await readGitHubSnapshot({ repository: s.repository, sha, ref: s.ref }, async path => {
    requested.push(path); assert.ok(Object.hasOwn(responses, path)); return responses[path]
  })
  assert.equal(requested.length, 5); assert.deepEqual(loaded, s)
  await assert.rejects(readGitHubSnapshot({ repository: 'other/repo', sha, ref: s.ref }, () => { throw new Error('Must not request') }), /Invalid target/)
  await assert.rejects(readGitHubSnapshot({ repository: s.repository, sha: '../invalid', ref: s.ref }, () => { throw new Error('Must not request') }), /Invalid target/)
  const script = new URL('../scripts/azure/check-github.js', import.meta.url).pathname
  const result = spawnSync(process.execPath, [script], { env: { GITHUB_REPOSITORY: s.repository, GITHUB_SHA: sha }, encoding: 'utf8' })
  assert.equal(result.status, 1); assert.equal(result.stdout, '')
  assert.equal(result.stderr.trim(), 'Deployment blocked: GitHub policy or exact-commit checks could not be verified')
})
