# Azure Deployment Readiness

Current follow-up: [2026-10-16 assessment](azure-first-deployment-assessment.md) and [operator / restore runbook](azure-operations.md). Historical PR #12 verification records below are retained as historical evidence.

Status: **NO-GO for provisioning and deployment**. This PR prepares files only. No Azure resource, identity, role assignment, federated credential, secret, deployment or GitHub protection is created by this work. No workflow provisions infrastructure. Do not run the delivery workflow as a test.

## Architecture

Node.js 24 / Express on App Service Linux B1, one instance and one Node process; PostgreSQL Flexible Server 17 / Standard_B1ms / 32 GiB Premium storage. Private PostgreSQL access uses separate delegated subnets (App Service /26; PostgreSQL /28) and private DNS. Sessions share the application's existing five-connection pool. No Redis or in-memory fallback. B1 has no staging slots; releases may interrupt service and are not zero-downtime.

The VNet address space 10.42.0.0/16 is an example infrastructure address allocation; check overlaps before provisioning. It is **not** an approved ingress proxy CIDR. App Service VNet integration is outbound connectivity; it does not establish the inbound proxy identity required by session security.

Key Vault Standard uses RBAC and a default-deny firewall allowing only the App Service delegated subnet through its Key Vault service endpoint. Linux App Service routes outbound traffic through the VNet. Public endpoint enabled on the vault does not mean unrestricted access: unauthorised networks and identities are denied. Verify this routing and negative network tests before opening deployment gates. There is no paid Private Endpoint, NAT Gateway, Front Door, Application Gateway, ACR or Log Analytics workspace in this design.

App Service has HTTPS Only, TLS >=1.2, FTP disabled, SCM basic authentication disabled, Always On, no client affinity and no automatic Azure build. `node --import ./instrument.js server.js` starts the one worker explicitly and uses Azure's PORT. Deploy a Linux-built immutable ZIP with runtime dependencies; no .env, tests, scripts, Git metadata or development dependencies. `package.json` may retain scripts whose development files are intentionally absent from the runtime package.

## Mandatory closed gates

`infra/azure/readiness.json` commits `deploymentEnabled:false` and six blocked gates. `scripts/azure/check-readiness.js` exits nonzero before OIDC. The preparation CI separately requires the lock to remain closed; a future reviewed activation PR must intentionally update that preparation-only check.

The non-secret configuration in `infra/azure/configuration.json` deliberately has unresolved region/origin/proxy values. The guard reuses the existing session parser, rejects invalid names (including a prefix longer than seven characters so generated vault names fit Azure limits), broad proxy ranges and shared/reserved DB roles. Use these reviewed configuration values for Bicep parameters; syntax validation does not prove cloud compatibility.

A future activation needs explicit owner authorization, a new reviewed PR updating the manifest, and evidence references to project GitHub issues/PRs for **every** gate. URL syntax checks are structural safeguards, not proof that an experiment happened or that its conclusions are correct. A human reviewer must inspect the evidence and its freshness. Do not paste secrets, cookies, connection strings, account contents or raw request dumps into evidence.

| Gate | Required GO evidence |
| --- | --- |
| proxy | All ingress/peer/header/health checks below, in the exact intended hosting mode |
| abuseProtection | Implemented and tested protection of login and registration, including restart/multiple-worker behavior |
| subscriptionQuotas | Actual eligible offer, active subscription, remaining credit/expiry, allowed region, B1/B1ms capacity and quotas |
| costApproval | Current regional estimate, free allowance eligibility, billing protections and explicit budget approval |
| bootstrap | Approved private-network execution method, separate migration/runtime credentials, verified TLS, initialized schema, least privileges and resolved Key Vault references |
| restoreDrill | Authorized isolated restore exercise, session revocation procedure, recorded recovery results and rollback verification |

Any missing evidence, CI/Sonar failure, unverifiable environment policy or unapproved change means NO-GO. The current approval is preparation only and does not authorize these Azure operations.

## Proxy HTTPS: deployment blocker

Do not change `sessions/config.js` or `sessions/transport.js` to accommodate an unknown topology. The code requires an explicitly trusted **immediate socket peer**, one raw X-Forwarded-Proto header with the single value https, and Express req.secure. CIDRs must be IPv4 /24–/32 or IPv6 /64–/128. Keep Secure/HttpOnly/SameSite=Lax/__Host cookie constraints, fixed eight-hour lifetime and canonical PUBLIC_ORIGIN.

Microsoft documents TLS termination and forwarding headers, but this does not establish a stable narrow trustworthy peer allowlist or header sanitization. App inbound/outbound public IPs, service tags and the VNet integration subnet must not be substituted for immediate peer identities. No guessed CIDR is supplied by these templates.

Before any future deployment to the application, obtain documented platform guarantees or authorize a separate isolated diagnostic environment (not this PR), with no accounts, sessions or secrets, and establish:

1. Hosting mode, complete ingress chain and immediate socket addresses; repeat after restart, instance replacement and any scale/change of plan. Record only allowlist-relevant network facts, not cookies or user data.
2. A narrow allowlist whose every member is trusted; lifecycle/update procedure and fail-closed behavior during changes. Seeing an address once is insufficient evidence.
3. Node's listener is unreachable except through that boundary, including alternate hostnames, deployment/SCM paths and any future proxy/slot route. VNet outbound integration alone does not prove this.
4. HTTPS-only edge behavior and canonical origin; the platform overwrites/rejects spoofed protocol headers. Exercise missing, http, arbitrary, mixed-case, comma-separated and duplicate X-Forwarded-Proto headers and client-supplied Forwarded/X-Forwarded-Host; verify no HTTPS elevation, cookie or session write on rejected paths. Edge normalization of duplicates must not make untrusted protocol information authoritative.
5. Authentic health/warm-up probes pass the same transport policy. Check HTTPS Only plus observed peer/header behavior. No general health-path exemption from the transport guard.
6. Browser login/registration/logout and cookie replay: Secure/HttpOnly/__Host properties, fixed expiry, POST logout/origin checks, persistence after restart and raw-cookie rejection after logout.

Local tests cover application-side transport decisions, including health and existing duplicate-header tests. They do **not** prove Azure topology. If narrow trust cannot be demonstrated, deployment stays blocked and a different reviewed ingress design is required. No trust-proxy=true, hop-count trust, broad private ranges, header fallback or TLS/cookie exception.

## Authentication abuse protection — PR #13

Login and registration now require PostgreSQL-backed admission budgets before session middleware and bcrypt. See [architecture, thresholds and limits](authentication-abuse.md). This is local application protection, not evidence of trustworthy Azure client IP resolution or Internet readiness. All six readiness gates and deploymentEnabled:false remain unchanged.

The explicit private bootstrap sequence now includes `npm run db:init:abuse` after application/session initialization and before applying runtime grants. The additive migration preserves all users, carts, products and sessions. Runtime performs read-only schema/privilege checks; it never initializes tables. The runtime role additionally needs SELECT, INSERT, UPDATE, DELETE on public.auth_abuse_counters, with no new sequence, ownership or DDL rights. No initializer is added to delivery.

Provision the independent `auth-abuse-hmac-key` secret only through the separately approved private Key Vault operator path. It contains 32 cryptographically random bytes encoded as 64 lowercase hex characters; app setting AUTH_ABUSE_HMAC_KEY uses a Key Vault reference. All workers and restarts must share its stable value. No key is generated at application startup, reused from session signing, logged or committed. Coordinate rotation with drained authentication traffic and all-worker restart; changing this key resets pseudonymous budgets. Old rows expire and are pruned on subsequent attempts. Rotation requires an operator decision, not routine deployment.

Azure verification remains mandatory: prove actual ingress/header sanitization and narrow peer trust; determine whether all visitors share a socket peer; measure bcrypt CPU credits, admission-lock wait/503 rate, PostgreSQL latency/storage and actual legitimate-user impact. Direct mode uses the socket peer; proxied mode also uses only that peer, explicitly not a claimed visitor IP. No forwarded IP header is trusted. A shared Azure proxy therefore shares the peer budget; do not open public traffic until this limitation is resolved under a separately approved trust-boundary design or demonstrated acceptable in the real topology. No CIDR or trust-proxy relaxation is introduced here.

## PostgreSQL TLS, schema and bootstrap

`db/config.js` stays unchanged: PGSSLMODE=verify-full, rejectUnauthorized=true and real hostname validation. Use the server's official FQDN, including when private DNS resolves it to a private address. Set PGSSLROOTCERT to the packaged public CA bundle. See [certificate provenance](../certificates/README.md); do not set NODE_TLS_REJECT_UNAUTHORIZED or use sslmode=require/disable as a workaround. Server require_secure_transport stays on.

No initializer runs at app startup or in the delivery workflow. Bicep creates the empty `vinyl_shop` database, not tables or LOGIN roles. Runtime validates session schema before listening and fails closed until bootstrap is complete.

Future bootstrap is a **separately authorized operation** from a controlled execution environment with VNet access to both PostgreSQL and the restricted vault. A public hosted GitHub runner cannot directly migrate the private DB. No runner, VPN, jump host, SSH tunnel or migration service is provisioned in this PR; select and cost that mechanism before clearing bootstrap. Never temporarily open PostgreSQL to all Azure services or 0.0.0.0/0.

- Supply the Bicep adminPassword secure parameter through an ARM Key Vault parameter reference to an existing authorized bootstrap vault. Never put its value in Bicep, .bicepparam/JSON, command arguments, outputs, GitHub variables or logs. The new runtime vault cannot bootstrap its own creation. Confirm external vault permissions before provisioning.
- Use the migration/admin identity solely for explicit `npm run db:init` then `npm run db:init:sessions` and `npm run db:init:abuse`, using verified TLS and environment-only configuration in the approved private execution environment. Initial demo catalogue seeding is deliberate and only for this demo; never reseed on each release.
- Create a distinct runtime LOGIN with no superuser, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, ownership or privileged memberships. Set its password through the protected operator/secret-manager workflow. Ensure PUBLIC does not grant CREATE on the database/schema. Never send passwords in SQL files or history.
- Apply `infra/azure/runtime-grants.sql` with psql variable runtime_role to grant only required table/sequence rights. The runtime can read products; read/insert/update users; operate carts/sessions; use only user/cart identity sequences. Test allowed operations and denial of DDL, product writes and access to unrelated databases/schemas. The grants file adds privileges; it does not remove pre-existing excessive privileges, so inspect the role and PUBLIC grants explicitly.
- Populate runtime-db-password, session-signing-key and session-verification-keys in the restricted vault through the approved private operator path. The current signing key must encode 32 cryptographically random bytes as 64 lowercase hex characters. The verification-keys secret is a JSON array (initially []), not an absent unresolved reference. Never log values.
- Managed identity receives only Key Vault Secrets User on the application vault. No application or deployment identity gets admin/migration credentials. Verify reference resolution and restart behavior without printing app settings. Keep the separate migration identity outside runtime app settings.
- Rotation follows docs/secure-sessions.md: compatible verification sets across all processes; retain old signing verification keys eight hours plus five minutes after the last signer stopped. Compromise requires immediate key removal and forced reauthentication. Account for Key Vault reference caching/refresh and restart before declaring rotation complete.

The five-connection pool is per process. B1ms defaults to 50 total / 35 user connections; retain headroom for migration/operations. Do not enable PM2 cluster/scaling without a revised connection and CPU-credit budget.

## GitHub OIDC and approval

No repository settings are changed by this PR. An authorized owner must configure and verify `azure-production` **before future activation**:

- At least one required human reviewer, administrator bypass disabled, custom deployment branch policy containing exactly branch main and no tag/wildcard rule. Decide whether to prevent self-review: enabling it needs another authorized reviewer in a solo-maintained repository. A workflow_dispatch click is not a substitute for environment review.
- Federated credential issuer https://token.actions.githubusercontent.com, subject repo:bakadja/vinyl-shop-fullstack-auth:environment:azure-production, audience api://AzureADTokenExchange. Do not federate arbitrary branches or PRs. The OIDC Bicep module prepares a dedicated user-assigned delivery identity, this exact federation and an app-scoped Website Contributor role assignment. Provision these only under new authorization; the delivery identity must not create its own rights.
- Deployment identity scoped to the existing web app, using Website Contributor as the documented app-deployment baseline, or a tested narrower custom deployment role. No subscription/resource-group Contributor, Owner, User Access Administrator, vault secret-read or PostgreSQL administration. App-scoped Website Contributor still permits app configuration changes; treat access to this workflow as privileged.
- Environment variables: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, AZURE_WEBAPP_NAME and AZURE_HEALTH_URL (the canonical HTTPS /health/ready URL). Identifiers are configuration, not client secrets. Do not create a client secret or publish profile. Scope OIDC id-token:write only to the deployment job.

Preflight checks the committed gates, latest main SHA, successful exact-commit post-push API tests and Azure readiness validation, SonarCloud check and environment policies via read-only GitHub API. Missing API access fails closed. Build has no OIDC. After mandatory environment approval, the deployment job repeats the gates and GitHub checks before Azure login, verifies the ZIP hash and deploys only application bytes. It never provisions infrastructure, runs migrations or changes app settings. Configuration drift checks against live Azure remain an additional required operator preflight, not verified by these offline tests.

## Validation and package

From repository root (no Azure login):

```sh
npm ci --ignore-scripts
npm audit --audit-level=high
# Existing helper creates a new fictional PostgreSQL cluster and never uses development data.
PG_TEST_BIN=/path/to/postgresql17/bin bash scripts/start-test-postgres.sh npm test
mkdir -p .cache
bicep build infra/azure/main.bicep --outfile .cache/azure-template.json
bicep lint infra/azure/main.bicep
node scripts/azure/validate.js
actionlint
```

The additional Azure validation workflow performs offline Bicep compilation/lint, compiled ARM policy checks, actionlint and guard/package/CA tests. It authenticates to no Azure account. Bicep/actionlint versions and Linux binary/archive hashes are pinned. Existing Linux/macOS tests and Sonar rules are preserved. YAML parsing is a development dependency only.

`node scripts/azure/check-readiness.js` **must currently exit 1**. Negative guard tests exercise missing evidence, unsafe URLs, missing/bypassed reviewers, wrong branches, stale main and failed/stale CI/Sonar. Runtime package tests exclude root .env/test files and reject hidden nested files and symlinks. Public CA tests verify fingerprints/self-signatures/expiry. Health tests cover real DB/HTTP routes, unavailable DB error sanitization and production trusted/untrusted transport. They do not contact Azure.

## Health, logs and monitoring

GET /health/live reports process liveness without querying PostgreSQL. GET /health/ready issues SELECT 1 using the existing pool with query_timeout=1000ms (pool acquisition separately limited by the existing 5000ms connection timeout). It returns 200 {status:ok} or sanitized 503 {status:unavailable}, no-store and no session cookie. These are connectivity checks, not full functional guarantees of every table/privilege. Both remain behind productionTransport and before session middleware.

Configure Azure readiness to /health/ready and verify real probe peer/headers. One instance cannot provide redundant traffic failover. No health bypass is added to make probes green.

Application warning/error filesystem logs are enabled. Raw HTTP access logs, detailed errors and failed-request tracing are disabled to reduce query-string/cookie/personal-data leakage. No log bodies, Authorization/Cookie/Set-Cookie headers, passwords, DATABASE_URL, SID, user records or complete app settings. Logs are local and not a durable audit store; define retention/export before public opening. Optional centralized telemetry is not provisioned. Use bounded, sampled, sanitized logs if it is later approved and costed.

Prepared metric alerts cover HTTP 5xx >5/5min, DB storage >80%, and active DB connections >25. They are disabled until an existing authorized action group ID is supplied; no notification destination is created. Also inspect CPU credits remaining, memory, DB latency, session cleanup failures and session-table growth in Azure Monitor. Validate real metrics and notification delivery before GO. Alerts/budgets are not automatic spending caps.

## Backups, restore and rollback

Native PostgreSQL backups retain seven days; geo-redundant backup and HA are disabled for this cost profile. Microsoft documents PITR with log-backup RPO potentially up to five minutes; RTO must be measured. No restore or paid second server is created here. Longer retention, HA, extra backup storage, restored servers and drills need separate approval and revised costs.

Future restore procedure: authorize the cost; restore to a separate private server; verify TLS and application data in isolation; invalidate all restored sessions before allowing traffic (restoring an earlier state can resurrect sessions revoked later); supply the correct current secret references; verify schema/runtime privileges and functionality; approve the connection-target change; reopen traffic only after checks; decommission temporary resources only after recovery acceptance. Never run test cleanup or DROP commands against production. Record measured RPO/RTO and cleanup responsibility. Keep sensitive backup exports encrypted and outside Git/CI artifacts.

Rollback on B1: stop further deliveries, identify the last approved artifact and SHA from the previous successful delivery run, verify its recorded hash and schema/key compatibility, then obtain the same production environment approval for a controlled redeployment. Retain artifacts 30 days; plan an approved external immutable archive if longer retention is required. The prepared delivery workflow intentionally builds current main only and does not yet implement an old-artifact rollback selector. An automated rollback workflow is **not implemented**; use a separately reviewed manual operator procedure or implement that selector before deployment GO. Do not silently rebuild an old SHA with new dependencies or run schema down-migrations. Database restore is disaster recovery, not routine release rollback. A failed post-deploy health check reports failure; it does not automatically roll back, destroy data or widen security settings.

## Azure for Students: cost and quota preflight

Observed 2026-10-15, hypothetical West Europe, USD retail excluding tax, 730h/month:

| Item | Rate | Monthly estimate |
| --- | --- | --- |
| Linux B1 | $0.018/hour | $13.14 |
| PostgreSQL B1ms | $0.0199/hour | $14.53 |
| PostgreSQL storage 32 GiB | $0.1369/GB-month | $4.38 |
| Base total | | $32.05 |

Allow approximately $35–40/month including small DNS/Key Vault/monitoring usage. This is an estimate, not a cap or quote; logs, alerts, egress, backup overage and restore/bootstrap infrastructure can increase it. Key Vault standard secret operations were $0.03/10,000 in the queried region. No reserved instance/savings-plan commitment.

Students advertises $100 credit for 12 months and, for eligible new accounts in the first 12 months, 750 B1ms hours/month plus 32GB DB and 32GB backup storage. If actually active, plan roughly $15–20/month for this setup at low usage. With the full $100 unused: around 5–6 months with the DB allowance, 2.5–3 months without it. Credit renewal does not prove renewal of the initial free-service window.

Before any provisioning, an authorized operator must inspect (read-only): subscription type/status and credit balance/expiry; free-service usage/eligibility; allowed-location policy; resource provider registration status; App Service Linux B1 availability/quota; PostgreSQL 17 Standard_B1ms capacity/quota; VNet/subnet permissions; Entra/federation and role assignment permissions; current region-specific pricing. Example metadata commands are `az account show`, `az policy assignment list`, `az provider show --namespace Microsoft.Web`, `az provider show --namespace Microsoft.DBforPostgreSQL`, `az postgres flexible-server list-skus --location <approved-region>` and App Service location/SKU listing. Read quota/policy scopes beyond subscription if inherited; list-skus does not prove actual capacity or entitlement. Do not register providers or request upgrades automatically. No subscription was inspected here and no region is approved by this PR.

Keep the Students spending protection; do not upgrade to pay-as-you-go. Plan budget notifications at 50/75/90% of the explicitly approved allowance and monitor remaining credit. Budgets alert; they do not halt spend. Stopping the web app does not stop plan billing; a stopped PostgreSQL server still incurs storage charges and can restart automatically. A funded cleanup plan must account for the plan, DB, DNS, monitoring and Key Vault soft-delete/purge protection. Do not delete resources without explicit authorization.

## Official references

- [Node.js 24 and proxy handling](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs?pivots=platform-linux)
- [App Service VNet integration](https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration)
- [Private PostgreSQL networking](https://learn.microsoft.com/en-us/azure/postgresql/network/concepts-networking-private)
- [Verified TLS and current roots](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect)
- [Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references)
- [OIDC App Service delivery](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions)
- [GitHub environments and reviewers](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Health checks](https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check)
- [Backups and PITR](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore)
- [Students allowances](https://azure.microsoft.com/en-us/free/students/)
- [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Budget limitations](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

## Preparation verification record (2026-10-15)

Base origin/main: 7e2f72ca8c3803fd178b98748eec7cda9fd52a87 (PR #11 merged). Isolated branch feat/azure-deployment-readiness.

Local macOS / Node 24.21.0 / PostgreSQL 17.11 / real Chromium: fresh npm ci --ignore-scripts; full ephemeral PostgreSQL npm test **160/160**, zero failures/cancellations/skips. npm audit and npm audit --omit=dev report zero vulnerabilities. Bicep 0.48.1 build/lint and compiled ARM policy validation pass; actionlint 1.7.12 passes. An actual allowlisted runtime directory was assembled and npm ci --omit=dev --ignore-scripts completed with zero vulnerabilities. All changed files passed deterministic Sonar secrets scanning before review/staging.

Two independent-review findings were corrected and regression-tested: require exact-commit Azure validation alongside API tests/Sonar; install locked guard dependencies on fresh deployment runners and distinguish the expected closed gate from loader errors. Final review found no remaining important defect by inspection. Local proxy and HTTPS smoke tests use fictional data and disposable certificates; they do not establish Azure compatibility. Shell sandbox restrictions were handled with writable temporary caches and authorized local ephemeral-test execution, without changing application protections.

The existing sessions/config.js, sessions/transport.js, db/config.js, db/init.sql, sonar-project.properties and API test workflow remain byte-identical to origin/main. No Azure commands, provisioning, deployment, paid operations or GitHub protection changes were performed. Remote PR checks are reported in the PR after execution and are not inferred from this local record.

## SonarCloud architecture findings requiring owner review

Initial PR analysis passed test/coverage execution but rejected its Quality Gate. Concrete implementation corrections address checked CLI filesystem boundaries, fixed-host GitHub HTTPS API calls instead of PATH-resolved commands, HTTPS-only download redirects, alphabetical comparison and resource formatting. Build/validation CLIs now accept no path arguments and use only the ignored `.cache` build directory; runtime assembly still validates its allowlist and rejects symlinks. The updated analysis result is recorded on the PR, not assumed from local checks.

Two initial findings cannot be resolved by a behavior-preserving code change within the approved design:

- **azureresourcemanager:S6380, app.bicep**: requires native App Service authsettingsV2 with platform authentication and requireAuthentication. Enabling it would reject anonymous catalogue/login/registration traffic before Express and alter the application's authentication contract. Existing application authorization and session protections remain in force. A separate owner-approved design, or an authorized context-specific Sonar assessment, is required; no rule suppression or issue-state change is made here.
- **azureresourcemanager:S6378, database.bicep**: flags absence of PostgreSQL server managed identity. No customer-managed encryption key, Storage/Fabric or other outbound Azure integration is configured. The application's Key Vault-backed runtime password and verified TLS do not become managed-identity database authentication by assigning an unused identity to the server. Do not add unused permissions/identities merely to satisfy analysis. An authorized reviewer must assess applicability or approve a real identity-based integration separately.

Both remain review blockers. The Draft PR must not be called Sonar-green, merged or deployed while its actual Quality Gate fails. Relevant official behavior: [App Service platform authentication](https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization), [PostgreSQL server identities](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-identity). No Sonar rules, exclusions, issue statuses or GitHub protections were changed.

Follow-up local verification after the concrete Sonar corrections: **161/161** complete isolated PostgreSQL/Chromium tests passed, zero failures/skips; Bicep build/lint, compiled ARM validation, actionlint, revised fixed-path runtime assembly and production dependency audit passed. Independent review of these corrections found no new important defect. The two architecture findings remain open pending the next remote analysis and an authorized review.
