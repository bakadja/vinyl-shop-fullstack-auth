# First Azure deployment assessment — 2026-10-16

**NO-GO: BLOCKERS REMAIN.** Audited base: `ca1530259c329c034c93fb01965bd521b3ebed2d`, latest origin/main at start, including merged Sentry PR #15. No Azure account, credentials, billing settings or resources were accessed. No deployment or paid resource was created. All six manifest gates remain blocked; deploymentEnabled remains false.

## Initial risk assessment and decisions

| Severity | Finding | Disposition |
| --- | --- | --- |
| Critical / deployment blocker | No verified narrow immediate-peer trust boundary for App Service Linux; client header normalization and probe transport unobserved | Preserve strict productionTransport; require independent live evidence or separately approved architecture |
| High | Admission budgets identify the socket peer; shared Azure ingress may impose one budget on all visitors | Keep abuseProtection blocked pending topology/load/legitimate-user validation; no forwarded visitor IP trust added |
| High | Private bootstrap execution, runtime LOGIN privilege matrix and Key Vault resolution not exercised on Azure | Keep bootstrap blocked; explicit ordered procedure in operations runbook |
| High | Subscription-specific eligibility, policy, quota, credit balance and regional capacity unknown | Keep subscriptionQuotas/costApproval blocked |
| High | Azure PITR and original-artifact rollback not exercised; B1 has no staging slots | Keep restoreDrill blocked; local drill is limited evidence |
| Medium | Offline ARM policy accepted lost VNet route-all/Always On and unbudgeted backup/HA/storage changes | Fixed and covered by rejection tests; existing Bicep profile unchanged |
| Review blocker | Historic PR #12 Sonar architecture issues may persist; current PR analysis required | Report exact-head remote result separately; no suppressions, issue status or protection changes |

Sentry remains unchanged, including its explicit preload startup command. The raw-event privacy review from PR #15 is deferred separately and is not part of this PR. No application/session/database security changes were needed for these offline fixes.

## Azure ingress evidence and alternatives

[Microsoft's Node guide](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs?pivots=platform-linux) confirms edge TLS termination and forwarded protocol headers. Its generic hop-count Express example does not prove this application's stricter trust contract. [VNet integration](https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration) provides outbound access and cannot establish inbound peer identity. [Health check documentation](https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check) describes platform probes; real peer/header behavior under this production transport policy remains unverified.

Current code trusts only configured narrow immediate-peer CIDRs, requires one unambiguous HTTPS protocol header plus req.secure, and rejects requests before session writes. It never uses X-Forwarded-For as an abuse identity. Retain Secure/HttpOnly/SameSite/__Host cookies, fixed expiry and canonical origin. No Azure ingress CIDR has been invented.

Preferred next action is an explicitly authorized minimal diagnostic environment with no accounts/session secrets, testing restart/replacement, alternate ingress paths and spoofed/duplicate headers. Observing one peer once is insufficient; establish a supported lifecycle and isolation guarantee. If that cannot be established, consider a separately reviewed owned TLS ingress and private authenticated backend boundary with demonstrable peers, sanitization and inaccessible bypass paths. Merely adding Front Door/Application Gateway in front of App Service does not establish the worker's immediate peer identity. An alternative hosting design exposing an operator-controlled backend boundary is another option, with new cost/operations review. Neither alternative is implemented or cost-approved here.

## Database and runtime audit

Explicit initializers serialize with transaction-scoped advisory locks and validate application/session/abuse schemas; none runs at runtime or delivery. Startup validates session and abuse storage/privileges before listening. PostgreSQL verified TLS and hostname validation remain mandatory outside local fixtures; pool limit is five connections per process. Connection failures fail closed; health failures return sanitized 503. Shutdown drains HTTP/store/pool with a bounded deadline; no memory store fallback exists.

Local tests cover these contracts and repeatable initialization. They do not prove private DNS, the actual PostgreSQL 17 B1ms offering, runtime role effective privileges or cloud failover. CA expiry/fingerprints are tested; reconfirm Azure's current certificate chain before bootstrap. A versioned migration history and automated old-artifact rollback selector do not exist; future schema evolution and rollback require deliberate review.

## Costs: facts, estimate and account unknowns

Public retail API queried on 2026-10-16 without authentication, filter `armRegionName eq 'westeurope'`, Consumption pricing, services Azure App Service and Azure Database for PostgreSQL. These are hypothetical regional USD list rates, not an approved region, contractual quote or subscription bill. See [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

| Meter | Observed unit price | 730-hour example |
| --- | --- | --- |
| Azure App Service Basic Plan - Linux / B1 | $0.018 per hour | $13.14 |
| PostgreSQL Flexible Server Burstable BS Series Compute / B1MS | $0.0199 per hour | $14.53 |
| PostgreSQL Flex Server Storage / Storage Data Stored | $0.1369 per GB-month | 32-unit approximation $4.38 |
| Compute plus base storage | | **$32.05/month** |

A planning envelope of **$35–40/month** allows modest ancillary use; it is not a cap. Meter GB versus provisioned GiB, taxes/currency, DNS, Key Vault operations, metric alerts, egress, backup overage, temporary bootstrap infrastructure and a second restored server can change the total. Recalculate in the owner's selected region/currency and approve a contingency before spending.

The [Students offer](https://azure.microsoft.com/en-us/free/students/) advertises $100/12 months and eligible first-year PostgreSQL B1ms hours/storage allowances. Whether they apply to this account is unknown; never assume B1 App Service is free. If PostgreSQL compute/base storage are actually covered, an illustrative $15–20/month envelope may be plausible; no entitlement is verified. Do not extrapolate full-year affordability from $100 credit. [Education terms](https://learn.microsoft.com/en-us/azure/education-hub/faq) restrict the offer's purposes; verify this remains an educational software demonstration rather than a commercial store.

[App Service plan charges](https://learn.microsoft.com/en-us/azure/app-service/overview-manage-costs) continue while the plan exists, even without apps. Stopped PostgreSQL retains storage/backup costs; [maintenance documentation](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-maintenance) describes seven-day automatic restart. [Spending limits](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit) protect most spending, not every possible charge; budgets are alerts, not shutoffs. [Students credit exhaustion/expiry](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/azurestudents-subscription-disabled) can disable services. Do not alter billing, add payment methods, remove limits or upgrade automatically.

### Owner cost-approval checklist

- [ ] Verify exact active Students offer, permitted purpose, credit balance/expiry and remaining first-year free-service quantities privately.
- [ ] Select approved region; check inherited location/SKU policy, PostgreSQL 17/B1ms and Linux B1 availability, quotas and actual allocatable capacity.
- [ ] Verify provider/Entra/OIDC/role-assignment permissions without automatically registering providers or requesting paid upgrades.
- [ ] Save dated regional calculator/retail worksheet covering all resources, restore overlap, operator networking, monitoring, egress and backup overage.
- [ ] Approve monthly allowance, contingency and stop/review dates before provisioning; preserve spending protection and separately authorize budget alert configuration.
- [ ] Assign credit monitoring and cleanup owner. Stopping apps is not plan cleanup; PostgreSQL stop is temporary. Account for Key Vault soft-delete/purge protection and retained recovery resources.
- [ ] Obtain explicit authorization for each future provisioning, restore drill and application delivery stage. No checklist completion here opens a gate.

## Gate evidence and exact remaining actions

| Gate | Current status | Available offline evidence | Missing independent evidence / owner action |
| --- | --- | --- | --- |
| proxy | BLOCKED | Strict transport regression suite; official documentation analysis | Approve diagnostics; prove immediate peer boundary, lifecycle, spoofed-header rejection, health/warm-up and browser cookie flows, or approve another architecture |
| abuseProtection | BLOCKED | Persistent counters, multi-process/restart/failure tests from main | Validate actual peer/client topology, shared budgets, CPU/DB load and legitimate-user impact |
| subscriptionQuotas | BLOCKED | B1/B1ms/private-network template reviewed | Privately verify offer, credit expiry, regional quotas/capacity and policy |
| costApproval | BLOCKED | Dated public list-rate estimate and checklist | Account-specific estimate and explicit spending approval, including bootstrap/restore |
| bootstrap | BLOCKED | Ordered initializers, TLS/schema tests and local repeatability | Approved private execution path; least-privilege LOGIN negative tests; resolved Key Vault refs; actual startup |
| restoreDrill | BLOCKED | Local five-table logical restore and session invalidation | Separately authorize Azure PITR; measure RPO/RTO, reject resurrected sessions, prove rollback and cleanup |

Keep the manifest untouched. A future reviewed activation PR needs real evidence, current exact-head CI/Sonar and explicit manual authorization. URLs or passing Bicep checks alone cannot satisfy any gate.

## Verification record

Local Node 24.21.0 / PostgreSQL 17.11 / macOS: fresh `npm ci --ignore-scripts`, zero audit vulnerabilities; baseline full disposable PostgreSQL/browser suite **187/187**, no failures/skips. New ARM mutations first failed with “Missing expected exception”; after correction all **11/11** Azure artifact/readiness tests pass. Bicep 0.48.1 build/lint, actionlint 1.7.12 and compiled repository ARM policy checks pass without Azure login.

The local restore exercise verifies five-table logical dump/restore with fictional data, repeatable initialization and session invalidation; it is not Azure PITR. Final full suite also passed **187/187**, zero failures/skips. An allowlisted runtime was assembled, installed with production-only locked dependencies (zero audit vulnerabilities), and exercised through the real Sentry preload startup; missing production configuration fails closed without missing-module errors. Changed files passed deterministic Sonar secrets scanning. Independent review and exact-head remote CI results are recorded in the Draft PR. Main baseline GitHub checks at ca15302 show successful API, Azure validation and SonarCloud analysis; that baseline is not evidence for this branch. Subscription Azure Policy evaluation, actual runtime/package behavior on Linux App Service, network/Key Vault access and restore remain unavailable without separately authorized Azure access; no unavailable check is marked passed.

Independent final review found no Critical/Important defect, independently passed artifact tests **5/5**, and confirmed the restore helper and unchanged closed gates. A stale verification placeholder was replaced before publication. Live-Azure items listed above were explicitly declined for lack of evidence, not accepted as verified.
