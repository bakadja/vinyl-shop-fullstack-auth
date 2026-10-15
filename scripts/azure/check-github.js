import { execFileSync } from 'node:child_process'
import { assertGitHubDeployment } from './guards.js'
function api(path) { return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) }
try {
  const repository = process.env.GITHUB_REPOSITORY
  const sha = process.env.GITHUB_SHA
  if (repository !== 'bakadja/vinyl-shop-fullstack-auth' || !/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('Invalid target')
  const base = `repos/${repository}`
  assertGitHubDeployment({ repository, sha, ref: process.env.GITHUB_REF,
    mainSha: api(`${base}/git/ref/heads/main`).object.sha,
    environment: api(`${base}/environments/azure-production`),
    branches: api(`${base}/environments/azure-production/deployment-branch-policies`).branch_policies,
    runs: api(`${base}/actions/runs?head_sha=${sha}&event=push&per_page=100`).workflow_runs,
    checks: api(`${base}/commits/${sha}/check-runs?per_page=100`).check_runs })
  console.log('GitHub main, CI, Sonar and mandatory environment review verified')
} catch {
  console.error('Deployment blocked: GitHub policy or exact-commit checks could not be verified')
  process.exitCode = 1
}
