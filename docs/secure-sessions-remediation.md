# PR #8 SonarCloud remediation

The 18 findings on `3404e8e` are addressed without analyzer suppressions or reduced TLS verification. Certificate generation no longer accepts a destination: it creates an exclusive, owner-only temporary directory, reserves fixed regular files with no-follow exclusive opens, and validates ownership, links and directory identity before cleanup. Keys remain mode 0600. OpenSSL receives fixed relative filenames.

The disposable CI installer verifies the PostgreSQL 17 container, exclusive IPv4 loopback binding, restricted database role and administrator-owned test marker before configuration. Its target must be exactly 127.0.0.1:5432. Certificates are installed as root in an atomic private directory under verified root-owned /run. Files remain root-owned, group-readable by postgres (0640); the directory becomes root:postgres 0750 only after installation. PostgreSQL cannot replace its parent, directory or entries. Ownership changes do not follow symlinks. TLS connections retain CA and hostname verification.

Configuration helpers reduce cognitive complexity while preserving secret, rotation, schema, cookie and proxy validation. Dependent certificate copies and SQL statements remain sequential through explicit helpers. The other maintainability changes use optional chaining, the existing iterable directly, and RegExp.exec.

## Independent review

A fresh-context review of `3404e8e..f26819f` found two important defects: IPv6 marker validation could authorize a different IPv4 admin endpoint, and postgres-owned installation paths allowed a lower-privileged filesystem actor to race root operations. Both were corrected before publication. The reviewer also identified that command-adapter tests alone do not execute Linux shell predicates; this limitation is recorded and additional checks accompany the corrections.

The existing 118 tests and assertions remain. New cases exercise malicious paths, preexisting files, symlinks, generation failure, restrictive modes, cleanup refusal, installation failures and sequential operations. Final post-review local validation passed 132/132, with zero failures, cancellations or skips. npm ci --ignore-scripts succeeded and npm audit --audit-level=high reported zero vulnerabilities. Follow-up independent review found no remaining Critical or Important issue; live Docker behavior and exact-head remote checks remain pending publication.

## Limits

A compromised host UID, root, Docker daemon, PATH or OpenSSL executable is outside the filesystem isolation boundary. The local macOS environment has no running Docker daemon; live service installation is validated by Linux CI. Azure ingress and reverse-proxy topology remain unverified; no deployment or provisioning is authorized. Execution artifacts and the implementation worktree are preserved.
