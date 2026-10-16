# First Azure deployment readiness implementation plan

Goal: complete safe offline readiness work and produce one reviewable Draft PR.
Architecture: preserve the existing deployment lock and secure runtime. Strengthen offline policy checks and document the unverified Azure boundary.
Spec: ../specs/2026-10-16-azure-first-deployment-design.md
Execution: inline, autonomous as explicitly requested by the owner; independent final review.

## Global constraints
No Azure deployment, provisioning, spending, credential access, merge or main push. All six gates blocked; deploymentEnabled=false. Preserve Sentry integration and TLS/session/abuse protections.

## Review focus
Outbound Key Vault routing drift; accidental HA/geo-backup/storage cost increase; restored revoked sessions; bootstrap role privilege drift; actual proxy/health behavior unproven by local tests.

## Task 1: Audit and strengthen ARM policy
- [x] Complete baseline local checks and official-document research.
- [x] Add failing mutation cases in test/azure-artifacts.test.js for routing, Always On, storage type, HA and geo backups.
- [x] Reject these regressions in scripts/azure/validate.js; require the explicit existing budget profile.
- [x] Run artifact tests, Bicep build/lint and compiled template policy validation.

## Task 2: Operations evidence
- [x] Exercise deterministic application/session/abuse initialization and local logical backup/restore using disposable fictional data.
- [x] Document exact safe bootstrap, restore/session invalidation, manual rollback and cost approval criteria.
- [x] Refresh documentation for Sentry startup and distinguish historic estimates from current verified facts.

## Task 3: Review and publication
- [x] Full isolated suite, dependency audit, runtime assembly/install, secrets and workflow checks.
- [x] Fresh independent whole-branch review; fix confirmed issues with regression tests.
- [x] Commit, push dedicated branch and create one Draft PR; attach it and inspect exact-head checks.
- [x] Report NO-GO with gate table and remaining owner actions; record unavailable checks truthfully.

## Execution record

Baseline and final full isolated suites: 187/187. ARM mutation test reproduced acceptance of unsafe drift, then passed after the validator correction. Azure artifact/readiness tests 11/11. Bicep build/lint, actionlint and compiled policy passed. Local logical restore passed; production package install/audit and fail-closed startup passed. All changed files scanned for secrets.

Independent reviewer found no Critical/Important issue, independently passed artifact tests 5/5, and identified a stale verification placeholder that had already been replaced with completed local evidence. Azure-only ingress, privilege, reference-resolution, quota/cost and restore claims remain unverified and blocked. No security contract or gate was relaxed. Publication and exact-head CI evidence are recorded in the Draft PR and final handoff.

Sonar follow-up: first remote Quality Gate rejected 32.7% new-code coverage because the standalone restore drill was not included in LCOV. Added a real integration test and version-matched Docker service clients to Linux CI; no scanner/exclusion/threshold changes. Native and Docker restore paths passed. A local coverage invocation first lacked its output directory; created it and reran.

Revised full coverage run: 188/188, zero skips/failures; overall line coverage 94.04%. Native and Docker restore integration paths independently pass. Final deterministic row ordering passed the focused restore test.

Final security follow-up: Sonar reached 90.5% new-code coverage, then correctly flagged PATH-based Docker resolution. Invalid-PATH Docker regression reproduced ENOENT; fixed absolute client paths and fixed child PATH remove the dependency. Final full suite and remote outcome are recorded in the PR. Independent review of the added Docker/CI boundary found no Important issue; reviewer could not rerun cluster setup inside its restricted sandbox, so execution evidence remains separately attributed.
