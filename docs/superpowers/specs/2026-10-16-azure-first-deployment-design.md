# First Azure deployment readiness design

The owner authorizes autonomous preparation, local validation, one feature branch and one Draft PR, and no Azure operations. Base: ca15302 (merged Sentry PR #15). Preserve Sentry and all authentication, TLS and cookie contracts. Keep deploymentEnabled false and all six gates blocked.

## Decisions

Audit the existing B1 / PostgreSQL 17 B1ms / private DNS / Key Vault / OIDC design rather than replacing it. Do not infer inbound trust from outbound VNet integration. Azure peer identity, header normalization and probe behavior require live evidence; shared-peer abuse budgets require real topology and capacity assessment. A possible alternative is an owned TLS ingress with a private, authenticated backend boundary and independently verified peer identity; this is a future separately costed architecture, not an implemented fix.

Strengthen offline ARM policy enforcement for required outbound routing and Always On, and the explicitly budgeted storage, backup and HA choices. Reject templates that alter these guarantees. Add adversarial mutation tests first. Compilation and these repository policy checks do not evaluate live Azure Policy, quotas or capacity.

Create practical bootstrap, cost approval, restore drill, release and rollback instructions, with evidence acceptance criteria and clear operator-only steps. Exercise initialization repeatability and logical backup/restore with fictional data only where local tooling permits. Local restore is not Azure PITR evidence.

## Verification and boundaries

Fresh npm installation, full isolated PostgreSQL/browser suite, dependency audits, deterministic secrets scanning, Bicep build/lint, workflow lint, runtime assembly and production dependency installation. Preserve unavailable/failed checks as blockers. Review the complete diff independently after implementation and correct confirmed defects. Push only the dedicated branch, open one Draft PR and inspect checks at its exact head. No merge, deployment, account access, resource mutation or protection changes.
