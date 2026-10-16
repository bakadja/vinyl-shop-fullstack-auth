# Azure VM architecture design

The owner requests a secure, reproducible, cost-optimized Azure for Students deployment plan for Vinyl Shop, with a target below $5/month if feasible. Work stays offline: no Azure account access, provisioning, deployment, spend, merge, main push, billing changes, or security-gate changes. Preserve the existing App Service architecture for comparison and keep `deploymentEnabled=false` with all six gates blocked.

## Selected approach

Keep the existing App Service B1 deployment artifacts unchanged as the baseline. Add a separate, review-only Bicep entry point for the proposed Poland Central Linux VM, private PostgreSQL Flexible Server, private DNS, VNet, Key Vault, and system-assigned VM identity. Its parameters default to no public IP or SSH ingress. No workflow invokes this template.

For the proposed public-demo option, a Standard public IPv4 is attached directly to the VM only when explicitly enabled in a future owner-reviewed deployment. NSG rules then allow HTTP/HTTPS; SSH requires an explicit narrow owner CIDR and SSH public key. The private PostgreSQL subnet remains dedicated and delegated; PostgreSQL public networking remains disabled. No NAT Gateway or paid ingress service is introduced into the base candidate.

Caddy terminates HTTPS and proxies to an Express listener bound to `127.0.0.1`. The app trusts only the exact loopback peer `/32`; Caddy's documented defaults replace client-supplied `X-Forwarded-*` values. Express continues requiring the immediate peer and one HTTPS protocol value. Abuse counters continue keying on the immediate socket peer, so all visitors proxied through this one local Caddy peer share peer-level limits; this remains an explicit abuse-protection blocker rather than changing rate-limit identity semantics.

Cloud-init installs Ubuntu 24.04 updates, Node.js 24, Caddy, and a locked-down systemd service. It contains no runtime secret values. The VM identity receives only Key Vault Secrets User at the vault scope; a bounded boot-time fetch writes a root-managed, mode-restricted environment file and never logs secret values. Runtime startup fails closed if secret retrieval, database TLS, schema, or PostgreSQL connectivity fails.

## Cost and evidence rules

Use the official Retail Prices API for Poland Central list-price observations, 730-hour arithmetic, and official Azure for Students allowance documentation. Keep list prices, owner-reported portal allowances, hypothetical in-limit credit consumption, and subscription-specific unknowns separate. Include network egress, DNS, Key Vault, boot diagnostics, monitoring, backups, and restore operations. Budgets are alerts, not spending caps. No free claim is made for a related meter without evidence.

The $5 target is tested against unavoidable public IPv4 and private DNS costs and variable operations. The VM's 1 GiB RAM must be measured under a 1 GiB local memory limit with the app and Caddy before claiming compatibility. Local tests do not certify Azure behavior.

## Security and release boundaries

Test Caddy header normalization, transport peer checks, cookie properties, direct-backend bypass, health behavior, and spoofed forwarding headers using disposable local fixtures. Do not open PostgreSQL publicly or weaken session/auth controls. Preserve the six blocked gates because subscription eligibility, proxy lifecycle, abuse impact, quota/capacity, bootstrap privilege, and Azure PITR remain unverified. Provide operator-reviewed SSH, updates, bootstrap, backup/restore, rollback, cleanup, and budget runbooks. The final result is NO-GO until each gate is independently evidenced and the owner approves future spend and deployment.
