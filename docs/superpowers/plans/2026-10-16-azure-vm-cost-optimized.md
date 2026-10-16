# Azure VM cost-optimized architecture Implementation Plan

> **For agentic workers:** Use this plan task by task. Preserve the PR #16 feature branch and keep this Draft PR open.

**Goal:** Prepare an offline, reviewable VM architecture and determine whether it can meet the Azure student-credit target without weakening Vinyl Shop security.

**Architecture:** Keep the current App Service design as the baseline and add a separate Bicep VM candidate. Caddy terminates TLS and forwards locally to Express; PostgreSQL stays on a private delegated subnet. The manifest and all six deployment gates remain closed.

**Tech Stack:** Bicep, Ubuntu 24.04, Node.js 24, Caddy, systemd, PostgreSQL Flexible Server 17, Key Vault, Node test runner, Docker.

**Spec:** `../specs/2026-10-16-azure-vm-architecture-design.md` and the user-provided requirements.

## Global Constraints

- Never deploy Azure resources, consume credits, change billing settings, merge, or push to main.
- Keep `infra/azure/readiness.json` at `deploymentEnabled=false` and all six gates blocked.
- Preserve the prior App Service architecture, Sentry Cloud EU, TLS, session, cookie, and authentication protections.
- Never expose PostgreSQL publicly or put secret values in cloud-init, code, templates, logs, or committed files.
- Use only the existing feature branch and existing Draft PR #16.

## Review Focus

- Client-controlled `X-Forwarded-*` headers must not satisfy the production HTTPS contract.
- Express must not be directly reachable around Caddy; trust only the observed loopback peer.
- Shared Caddy socket identity can collapse visitor rate limits and remains a deployment blocker.
- Free-tier eligibility, remaining credit, region quota, capacity, and actual bill are account-specific.
- 1 GiB RAM compatibility and Azure restore/rollback remain unproven until measured in their target contexts.

---

### Task 1: Add VM candidate policy tests

**Files:**
- Create: `test/azure-vm.test.js`
- Create: `infra/azure/vm/main.bicep`
- Create: `infra/azure/vm/cloud-init.yaml`

- [x] Add adversarial compiled-template policy checks for conditional public IP/ingress, narrow SSH, locked PostgreSQL, Key Vault, identity and cost defaults.
- [x] Implement the separate VNet, VM subnet/NSG, delegated PostgreSQL subnet/private DNS, VM, conditional Standard public IP, Key Vault, managed identity and role assignment.
- [x] Compile/lint both Bicep entry points and run the focused policy tests.

### Task 2: Bind Express behind local Caddy

**Files:**
- Modify: `server.js`
- Modify: `test/session-config.test.js`
- Modify: `infra/azure/vm/cloud-init.yaml`

- [x] Test explicit production loopback binding while retaining the existing App Service listener when the setting is absent.
- [x] Configure the VM-only systemd service to bind Express to `127.0.0.1`, trust only `127.0.0.1/32`, and let local Caddy terminate TLS.
- [x] Run a disposable Caddy HTTP/TLS forwarding-header spoof test. Direct-backend reachability remains an Azure topology gate.
- [ ] Clear the local session-expiry integration failure and run the Chromium browser test outside the restrictive macOS sandbox.

### Task 3: Document cost, topology, runtime evidence, and operations

**Files:**
- Create: `docs/azure-vm-architecture.md`
- Modify: `docs/azure-deployment.md`
- Modify: `docs/azure-operations.md`
- Modify: `.github/workflows/azure-validate.yml`
- Modify: `scripts/azure/validate.js`

- [x] Add Bicep compilation and offline policy checks for the VM candidate without adding a deployment trigger.
- [x] Record 2026-10-16 regional price observations, scenario calculations, free-tier limits, unknowns, and the <$5 feasibility decision.
- [x] Record Caddy/header behavior and a 1-GiB local memory smoke result with limitations; document SSH, updates, Key Vault bootstrap, PostgreSQL, restore, rollback, cleanup, and budget procedures.
- [x] Verify the deployment lock and all six gates remain blocked.

### Task 4: Full verification, independent review, and PR update

**Files:** All changed files on the existing PR #16 branch.

- [ ] Resolve local full-suite blockers: 189/191 pass; session-expiry integration fails in the local disposable PostgreSQL run, and Chromium is blocked by the macOS sandbox.
- [x] Run Bicep build/lint/policy tests, focused VM/session tests, npm audit, runtime-package/memory smoke checks, actionlint, and deterministic secrets scans.
- [ ] Complete an independent review if an available provider supports this PR; manually inspect changes in the meantime.
- [ ] Commit and push only the existing feature branch, update PR #16 description with the current exact-head evidence, and leave it Draft/open.
- [ ] Report NO-GO and owner approval checklist; do not deploy or merge.
