import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertGitHubDeployment } from './guards.js'
async function api(path) {
  if (!process.env.GH_TOKEN) throw new Error('GitHub credential unavailable')
  const response = await fetch(`https://api.github.com/${path}`, { redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
  if (!response.ok) throw new Error('GitHub API unavailable')
  return response.json()
}
export async function readGitHubSnapshot({ repository, sha, ref }, request = api) {
  if (repository !== 'bakadja/vinyl-shop-fullstack-auth' || !/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('Invalid target')
  const base = `repos/${repository}`
  const [main, environment, branches, runs, checks] = await Promise.all([
    request(`${base}/git/ref/heads/main`), request(`${base}/environments/azure-production`),
    request(`${base}/environments/azure-production/deployment-branch-policies`),
    request(`${base}/actions/runs?head_sha=${sha}&event=push&per_page=100`), request(`${base}/commits/${sha}/check-runs?per_page=100`)
  ])
  return { repository, sha, ref, mainSha: main.object.sha, environment, branches: branches.branch_policies, runs: runs.workflow_runs, checks: checks.check_runs }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertGitHubDeployment(await readGitHubSnapshot({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF }))
    console.log('GitHub main, CI, Sonar and mandatory environment review verified')
  } catch {
    console.error('Deployment blocked: GitHub policy or exact-commit checks could not be verified')
    process.exitCode = 1
  }
}
