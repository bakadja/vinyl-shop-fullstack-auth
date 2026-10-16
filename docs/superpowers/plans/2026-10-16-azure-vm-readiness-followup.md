# Azure VM Readiness Follow-up Implementation Plan

> **For agentic workers:** Use the existing Draft PR #16 branch; keep deployment disabled and all six gates blocked.

**Goal:** Resolve offline security and runtime-evidence gaps for the low-cost Azure VM candidate without weakening security or authorizing cloud activity.

**Architecture:** Preserve the public IPv4 → Caddy → loopback Express → private PostgreSQL design. Use only a client address that the direct Caddy connection establishes, and validate the exact loopback proxy boundary in Express. Measure representative app traffic with an isolated database and a 1-GiB container limit. Keep Azure-only facts blocked.

**Tech Stack:** Node.js 24, Express, Caddy, PostgreSQL 17, Docker, Bicep, Node test runner.

**Spec:** `/Users/kev/.codex/attachments/dee596a4-d567-4197-a2e5-20b5a9755b45/goal-objective.md` and `docs/superpowers/specs/2026-10-16-azure-vm-architecture-design.md`.

## Global Constraints

- Do not deploy Azure, register features/providers, spend credits, alter billing, upgrade SKUs, merge, or push to main.
- Keep `infra/azure/readiness.json` at `deploymentEnabled=false` with all six gates `blocked`.
- Keep the existing PR #16 Draft; commit and push only to its branch.
- Do not trust client-supplied forwarding headers, invent proxy CIDRs, remove PostgreSQL abuse protection, or expose PostgreSQL publicly.
- Use fictional data and an isolated disposable PostgreSQL instance for local testing.
- Treat Azure identity/network/quota/cost/restore claims as unverified until owner-authorized live evidence exists.

## Review Focus

- Spoofed, duplicated, malformed, or multi-hop forwarding headers must not alter the rate-limit identity.
- A direct backend connection must fail production transport checks and cannot become a trusted proxy.
- Auth/database failures must deny admission without session creation or memory fallback.
- 1-GiB memory evidence must cover auth, registration, browsing/cart, concurrent requests, restart, and database connectivity.
- Retail price, free allowance, credit consumption, and unknown subscription-specific cost must remain separate claims.

---

### Task 1: Establish a safe visitor identity through local Caddy

**Files:** `sessions/abuse.js`, `server.js`, `infra/azure/vm/cloud-init.yaml`, `test/auth-abuse.test.js`, `test/session-transport.test.js`, `docs/authentication-abuse.md`, `docs/azure-vm-architecture.md`.

- [x] Add failing tests for trusted-loopback forwarding identity, malformed/duplicate/multi-hop rejection, and direct-peer spoof resistance.
- [x] Make Caddy overwrite `X-Forwarded-For` from its direct socket peer; in Express accept one valid address only from the configured trusted loopback proxy. Preserve direct-mode socket identity and fail closed on missing or ambiguous proxy identity.
- [x] Add/extend an isolated Caddy-to-Express test proving a client-supplied XFF cannot change identity and verify transport, cookies, health, and backend binding behavior.
- [x] Run focused tests and the full isolated suite (195/195); update docs to state local evidence and Azure limitations.

### Task 2: Measure representative runtime behavior at 1 GiB

**Files:** Create `scripts/azure/runtime-load.js`; update `docs/azure-vm-architecture.md` and `docs/azure-first-deployment-assessment.md`.

- [x] Use an isolated PostgreSQL 17 fixture and app+Caddy containers capped at 768 MiB combined, reserving 256 MiB of the 1-GiB candidate budget for guest OS/agents.
- [x] Record readiness/restart, registration/login, products/cart, concurrent reads/authentication, memory peaks, no-OOM result, and persisted recovery in the reproducible workload script and architecture assessment.
- [x] State Docker/host/emulation and Azure guest/kernel/agent limitations; keep the 1-GiB candidate and abuse gates blocked pending Azure evidence and acceptance of observed 503 back-pressure.

### Task 3: Audit Azure identity, database, cost and readiness evidence

**Files:** `infra/azure/vm/main.bicep`, `infra/azure/vm/cloud-init.yaml`, `infra/azure/runtime-grants.sql`, Azure architecture/operations/assessment docs, readiness validators and tests only if a concrete offline gap is found.

- [x] Audit Managed Identity scope, Key Vault deny-by-default/network rules, secret-fetch failure/restart behavior, private DNS/TLS, and DB role separation from current files/tests; cloud execution remains unverified.
- [x] Retain the dated official retail/Students snapshot and owner-reported account facts separately; state that neither proves a 5 EUR/month all-in cap.
- [x] Preserve all six blocked gates and identify each remaining owner-authorized Azure check and required evidence.

### Task 4: Verify, update the existing PR and report

- [x] Run focused/full PostgreSQL-backed regression (195/195), runtime workload, Azure artifact validation and secrets scans. Local actionlint is unavailable and npm audit could not reach registry.npmjs.org; exact-head remote checks remain required.
- [ ] Verify the exact pushed SHA and GitHub/Sonar status; review the complete diff.
- [ ] Commit and push only the existing PR branch, update PR #16 description, and keep it Draft/open.
- [ ] Report evidence, remaining blockers, financial limits, and NO-GO recommendation.
