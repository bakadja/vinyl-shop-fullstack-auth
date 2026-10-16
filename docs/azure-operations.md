# Azure first-deployment operations and restore drill

Status as of 2026-10-16: **NO-GO**. This is an operator runbook for a future separately authorized exercise. None of these Azure operations has been performed. Deployment is disabled and all six gates remain blocked. See [readiness assessment](azure-first-deployment-assessment.md) and [architecture/security reference](azure-deployment.md).

## Approval and preparation

1. Owner reviews the Draft PR, exact-head CI/Sonar, proxy feasibility, cost worksheet and all gate evidence. Resolve each failed check before any activation proposal. Do not run the delivery workflow to test it.
2. Owner selects the subscription and region, checks the Students offer/credit expiry and actual available B1/B1ms PostgreSQL 17 quotas, inherited policies, provider registrations and required permissions. Do not print account IDs or app settings into public evidence. No provider registration, quota request, billing change or credential retrieval is part of this preparation.
3. Approve a private-network operator method reaching both PostgreSQL and the restricted Key Vault. A hosted GitHub runner has no such access. Budget a temporary operator VM/VPN/other execution path separately; none is supplied here.
4. Independently establish a supported inbound trust boundary, stable immediate peers, header sanitization and authentic health/warm-up behavior. The outbound VNet subnet cannot identify the ingress proxy. Demonstrate legitimate-user behavior of shared-peer abuse budgets. If unavailable, stop and redesign ingress under a separate approval.
5. Obtain distinct approvals for provisioning, diagnostics/restore costs and later application delivery. The current work authorizes none of them. A future activation PR must preserve human environment approval and exact-head checks, and supply independently reviewed evidence for each gate.

## Private bootstrap, only after future authorization

Use the immutable reviewed revision of the repository and the approved private operator environment. Supply PostgreSQL configuration through a protected environment/secret manager; never use password command arguments, checked-in parameter files, shell tracing, SQL history or log dumps. Use the official server FQDN and `PGSSLMODE=verify-full`, the approved public root bundle and `NODE_ENV=production`. Confirm hostname/certificate verification and reject an incorrect CA/hostname before proceeding.

Bicep creates `vinyl_shop` without tables. The migration identity owns the application objects; the runtime LOGIN must be distinct and unprivileged. The bootstrap password comes from an existing authorized bootstrap vault via a secure ARM parameter reference, not the vault being created.

Run explicitly, in order, with migration credentials:

```sh
npm ci --ignore-scripts
npm run db:init
npm run db:init:sessions
npm run db:init:abuse
```

The first initializer intentionally seeds ten fictional catalogue products for this demo. Review that decision before first use. No migration runs in server startup or the delivery workflow. Repeat initialization only deliberately; current initializers are transactional and preserve existing rows, but this is not a general versioned down-migration framework.

Create/password `vinyl_runtime` through the protected database operator path. Verify NO SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS, no privileged memberships or object ownership. Inspect PUBLIC database/schema grants; the grants file only adds privileges. Revoke unwanted inherited/public access through an independently reviewed database security procedure. Apply:

```sh
psql -X --set ON_ERROR_STOP=1 --set runtime_role=vinyl_runtime --file infra/azure/runtime-grants.sql
```

Do not put the migration credential into App Service. Test runtime SELECT products; user creation/read/update; cart DML; session DML; abuse admission counters; and user/cart identity sequences. Test denial of CREATE/ALTER/DROP, product writes, role changes and unrelated objects. Inspect effective privileges and ownership, not only role attributes. Local fixture tests run as a schema owner and do not establish this Azure least-privilege matrix.

Populate the five referenced application secrets through the approved private path: runtime-db-password, session-signing-key, session-verification-keys, auth-abuse-hmac-key, sentry-dsn. The bootstrap admin secret stays in its separate external vault. Session previous keys must initially be the JSON array `[]`. Current signing and independent abuse keys each encode 32 random bytes as 64 lowercase hex characters. Inspect reference resolution status without printing values; allow for RBAC propagation/reference caching and restart. Sentry startup must use `node --import ./instrument.js server.js`. Raw-event privacy follow-up from PR #15 stays separate.

Fail closed on bootstrap, reference resolution, startup or TLS failure. Never broaden a firewall, trust proxy, disable TLS or remove schema checks to recover.

## Restore drill, only after future authorization

Assign incident lead, database operator, independent verifier, spending approver and cleanup owner. Record approved resource IDs privately, backup retention, chosen UTC recovery point, source revision/schema version, expected lost writes, budget and maximum drill duration. Do not use customer data in a diagnostic environment without a separately approved handling plan.

1. Quiesce writes and prevent public traffic reaching the restore target. Preserve the original server and approved artifact. Record incident time and intended recovery point; native PITR creates another server and incurs costs.
2. Restore to a distinct private PostgreSQL server using Azure's approved PITR procedure. Re-establish private DNS/networking and verified TLS. Confirm the new target explicitly before any SQL write. Never repurpose the test cleanup helper for a real server.
3. Verify schema, constraints/indexes, sequence state and representative products/users/carts against the recovery point. Assess missing writes; record measured RPO and elapsed RTO. Restore roles/permissions and secret compatibility deliberately; an old password/key may no longer be current.
4. **Before traffic**, in a transaction on the verified restored `vinyl_shop` database, delete all rows from `public.user_sessions` and confirm zero remain. Restoring a backup can resurrect sessions revoked after that backup. Keep traffic closed until all processes use the intended current key set and old session replay is rejected. Do not assume rotating only the signing key invalidates every restored session.
5. Inspect abuse counters and expiry; preserve budgets where valid and explicitly assess any lost/reset security history. Verify registration/login/logout, cart, persistence across restart, rejected revoked cookies, database failure behavior, health and Sentry sanitized monitoring on the isolated target.
6. Independently accept data/security checks, record actual RPO/RTO and authorize connection-target/reference changes. Restart affected processes, verify readiness and browser flows, then authorize reopening traffic. A failed check leaves traffic closed and the original target intact for the incident lead's decision.
7. After recovery acceptance and explicit deletion authorization, remove drill/obsolete compute and associated paid dependencies. Verify residual DNS, disks/storage, alerts and Key Vault recovery/purge constraints. Retain sanitized evidence and encrypted backups according to the owner's retention policy; no dumps in Git, PRs or CI artifacts.

Microsoft documents seven-day default retention (up to 35 days) and a WAL backup RPO potentially up to five minutes; this is a platform capability, not a measured application RPO/RTO. See [backup and restore](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore).

## Reproducible local exercise

```sh
PG_TEST_BIN=/path/to/postgresql17/bin bash scripts/start-test-postgres.sh node test-support/azure-restore-drill.js
```

This creates a new local loopback-only cluster, verifies the restricted fixture marker, initializes all three schemas twice, dumps five tables containing fictional records, restores into a second fixture schema, compares all rows, invalidates restored sessions and verifies users/carts survive. Its schema remapping is for controlled random local identifiers only; it is not an Azure restore command. Cleanup checks schema identity and stops the disposable cluster. It never connects to an application database. Local PostgreSQL transport inside this exercise is deliberately test-only; the production TLS requirement is covered separately by the full suite.

This exercise passed on PostgreSQL 17.11 / Node 24.21.0 using native clients and an isolated PostgreSQL 17 Docker service. It is also part of `npm test`: the Linux CI service supplies its version-matched clients through Docker; the local/macOS cluster helper exports PG_TEST_BIN. It proves logical dump/restore and initialization repeatability only. Azure PITR, private DNS, runtime LOGIN grants, key-reference refresh and recovery time remain unverified; `restoreDrill` and `bootstrap` stay blocked.

## Release and rollback, only after future authorization

First release requires bootstrap, an immutable Linux-built ZIP with production dependencies, SHA/hash record, exact-head API/Azure/Sonar success and verified `azure-production` reviewers/branch restrictions. Delivery has no migrations and cannot authorize its own activation. Inspect live configuration drift before OIDC login. Independently verify health probes, cookies, login/logout, persistence, abuse controls and sanitized monitoring after release.

B1 has no deployment slots. Schedule an interruption window. For rollback, stop new deliveries, select the previously approved retained ZIP and verify its recorded hash, provenance, schema and signing-key compatibility. Obtain the same human production approval, then have the authorized operator redeploy those exact bytes through a separately reviewed procedure. Never rebuild an old SHA with current dependencies. The existing workflow only builds latest main; an old-artifact selector is not implemented. First-release failure has no prior artifact: close traffic and repair under incident approval; do not claim automatic rollback. Do not run schema down-migrations or PITR as routine code rollback.

Retain an approved prior artifact before a later release; current CI retention is 30 days. A failed smoke check reports failure and requires intervention; it does not auto-rollback or widen access. Monitor B1/B1ms CPU/memory/credits, pool use (five per process), connections, storage, error rates, session pruning and Sentry delivery. Alert destinations and signal validity must be tested under separate authorization.
