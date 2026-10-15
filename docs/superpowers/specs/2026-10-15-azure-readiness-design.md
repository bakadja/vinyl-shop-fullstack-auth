# Azure Deployment Readiness — approved design

Approved in chat on 2026-10-15. Prepare only: no Azure resources, spending, deployment, merge, or GitHub protection changes.

App Service Linux B1 / Node 24; PostgreSQL 17 B1ms with 32 GiB, private networking, verified TLS, persistent existing sessions. Key Vault references and managed identity; GitHub environment-bound OIDC with least privilege and mandatory approval. Bicep only, no provisioning workflow. Runtime DB role distinct from migration/admin roles. One worker initially; no slots on B1.

Azure proxy compatibility is a mandatory unresolved blocker. Keep sessions/config.js and sessions/transport.js unchanged. No broad proxy trust, header fallback, TLS exceptions or insecure health bypass. Add session-free health endpoints behind the existing transport guard. Abuse protection remains explicitly unimplemented and blocks public deployment. Quotas, offer eligibility, costs, bootstrap/migration network access and restore exercise need evidence before deployment.

All deployment gates default closed in a committed readiness manifest. The future deployment workflow must fail before Azure login until a reviewed change supplies evidence and unlocks deployment. Validate GitHub main/CI/Sonar/environment rules before OIDC; never modify repository settings. Build a secret-free immutable package; manually approved redeployment supplies rollback. No automatic schema initialization or seed on app start. Preserve db/init.sql, Sonar rules and all existing tests.
