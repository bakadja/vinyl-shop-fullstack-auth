# Dependency Security Hardening Implementation Plan

**Goal:** Reduce dependency vulnerabilities on Node.js 24 without changing business behavior; deliver draft PR #4 against main.

**Architecture:** Update supported Express 4 and validator releases and their compatible transitives. Evaluate sqlite3 6.0.1 to remove obsolete native build dependencies, keeping the existing SQLite API and schema.

**Scope:** package.json, package-lock.json, .github/workflows/api-tests.yml and dependency security evidence under docs/. No PostgreSQL, Azure, Sentry, Express 5, secrets, deleted tests or weaker Sonar rules.

- [x] Establish merged main, protected ruleset, baseline audit and 29 passing tests.
- [x] Resolve dependency upgrades without audit fix --force; inspect remaining audit findings and installation scripts.
- [x] Require existing Linux check plus macOS Node 24 npm ci and all 29 tests, with a native SQLite smoke check.
- [x] Document versions, exposure, compatibility risks and before/after audit evidence.
- [ ] Review diff, run npm ci/tests/audit, push branch and create draft PR; verify GitHub Actions and Sonar gate. Do not merge.
