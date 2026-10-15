# Azure Deployment Readiness Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session, as authorized by the user. Tests precede new runtime behavior.

**Goal:** Prepare a locally verified Draft PR, without contacting Azure or enabling deployment.
**Architecture:** Bicep defines a low-cost private database architecture. Closed readiness gates protect future manually approved OIDC delivery. Health routes stay behind strict production transport and before sessions.
**Tech Stack:** Node.js 24, Express 4, PostgreSQL 17, Bicep, GitHub Actions.
**Spec:** ../specs/2026-10-15-azure-readiness-design.md

## Global Constraints
- No resource provisioning, deployment, merge, spend or GitHub protection mutation.
- Preserve db/init.sql, Sonar rules, session transport/configuration, verified database TLS and existing tests.
- Secrets only through external secret management; no real values in sources, outputs or logs.

## Review Focus
- Spoofed forwarding headers must still fail on health endpoints.
- DB errors must yield sanitized readiness failure without a cookie.
- Missing or malformed readiness evidence must fail closed.
- Missing reviewers, bypass or wrong deployment branches must fail before OIDC.
- Packaging must exclude environment files, tests, dev dependencies and credentials.

### Task 1: Health endpoints
Files: routes/health.js, server.js, test/health.test.js.
Interface: healthRouter(database) -> Express Router; GET /health/live and /health/ready.
- [x] Write and run failing route/integration tests for 200, 503, no cookies, bounded query and production transport rejection.
- [x] Implement minimal routes and registration after transport, before sessions.
- [x] Run health tests and full isolated PostgreSQL suite.

### Task 2: Infrastructure and deployment guards
Files: infra/azure/*, scripts/azure/*, test/azure-readiness.test.js.
Interfaces: assertReadiness(manifest), assertGitHubDeployment(snapshot), validateTemplate(template), validateWorkflow(workflow); throw generic errors on invalid input.
- [x] Write and run failing tests for closed gate, invalid evidence, unsafe templates and unsafe workflow mutations.
- [x] Implement private-network Bicep modules, secure parameters, runtime settings and gates.
- [x] Compile/lint Bicep and validate generated ARM resource properties; run tests.

### Task 3: Workflows, packaging and runbooks
Files: .github/workflows/azure-validate.yml, .github/workflows/azure-deploy.yml, scripts/azure/package.sh, docs/azure-deployment.md.
- [x] Add tested package assembly using explicit runtime allowlist and npm ci --omit=dev --ignore-scripts.
- [x] Add unprivileged validation CI; manual delivery with closed readiness gate, protected environment, OIDC and immutable artifact.
- [x] Document proxy proof, abuse NO-GO, quotas/costs, secret bootstrap, private migrations, backup/restore and rollback.
- [x] Run full suite, audit, Bicep and actionlint; perform independent review and corrections.
- [ ] Push scoped branch, create Draft PR and inspect Linux/macOS/Sonar checks. Do not merge.

## Execution rulings
- The user explicitly approved implementation and PR creation; no additional plan approval is required.
- Native worktree tool cannot locate the nested repository; Git fallback creates worktrees/azure-readiness.
- No Azure CLI/account session is used. Azure validation is offline compilation/policy only; quotas and proxy remain unverified.

## Local execution record

160/160 complete isolated PostgreSQL/Chromium tests passed. Fresh npm ci, full/production audit: zero vulnerabilities. Bicep build/lint, compiled ARM/security checks, actionlint and all changed-file secrets scans passed. Runtime assembly and locked production dependency installation passed. Independent review corrections are documented in docs/azure-deployment.md. Remote checks remain pending at local commit time. No Azure or GitHub protection mutation occurred.

Remote first PR run: Linux/macOS 160/160 and Azure validation passed; Sonar Quality Gate failed. Concrete corrections and security regression tests were added; follow-up local suite 161/161 passes. Native App Service auth / unused PostgreSQL identity findings remain architecture review blockers. No Sonar rule or issue state was modified.
