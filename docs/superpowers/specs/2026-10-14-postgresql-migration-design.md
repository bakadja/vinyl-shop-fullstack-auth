# PostgreSQL migration design — approved

## Intent and boundaries

Implement the supplied PR #7 request: replace SQLite with PostgreSQL and node-postgres while preserving HTTP responses, sessions, bcrypt password hashes, fictional catalogue, user isolation and DOM XSS protections. Local PostgreSQL runs through Docker Compose/Colima; Azure compatibility means verified TLS configuration only, with no Azure resources or deployment. Deliver `feat/postgresql-migration`, `docs/postgresql-migration.md`, and an English draft PR targeting main. Never merge, change rulesets/Sonar rules, migrate personal SQLite files, or add checkout/payments/Sentry.

## Inspected baseline

On 2026-10-14 GitHub reports PR #6 merged and main at `3abc50675c00f46156baeba615219ea962d6cb54`. The local checkout remains `fix/backend-frontend-reliability` at `2cfc99c`; local main and origin/main are stale. Before implementation fetch the merged baseline and create the requested branch from it, preserving the untracked `.DS_Store` and this draft. No AGENTS.md was found by the workspace scan.

Current persistence consists of `db/db.js`, `db/init.sql`, `scripts/init-db.js` and three controllers. Tests use private temporary SQLite files and real HTTP child processes. Linux and macOS job IDs are `test` and `test-macos`; SonarCloud is an external check, not a job in the inspected workflow. Docker, Colima and psql were not found in the current PATH. Their actual local availability remains to be established. The initial sandbox test run cannot bind HTTP sockets (EPERM); rerun with local listening enabled before interpreting test failures.

## Approach and alternatives

Use native `pg.Pool` queries in existing controllers. This is the recommended approach because it preserves the Express architecture and exposes PostgreSQL transaction and row-count semantics directly. A SQLite compatibility adapter would preserve misleading lastID/changes/close semantics; an ORM would add unrelated dependencies and structural changes. Neither is needed.

## Schema and initialization

Use integer generated identity primary keys, text for existing strings and password hashes, integer year/stock/quantity, exact `numeric(10,2)` price and timestamp with time zone for creation time. Keep current nullable columns nullable and current unique email/username semantics. Add enforced foreign keys with default restrictive deletion and a unique `(user_id, product_id)` constraint. Quote aliases where camelCase is required; convert numeric price and aggregate results explicitly at the response boundary so existing JSON numbers remain numbers. Reject malformed, non-finite and unsafe integer values; never silently coerce invalid values to zero or globally override pg type parsers.

Keep the same ten fictional products, IDs and image paths. Initialization uses one acquired client for BEGIN/COMMIT/ROLLBACK, with release in finally. Serialize concurrent initialization with a transaction advisory lock. Create tables if absent, seed missing catalogue IDs using ON CONFLICT DO NOTHING, and align the product identity sequence without moving it backwards. A second initialization must preserve accounts, hashes, carts and edited catalogue rows. Incompatible existing PostgreSQL schemas fail with a sanitized diagnostic rather than being silently accepted. No SQLite files are opened or imported.

The existing SQLite test that expects EEXIST needs an explicit semantic adaptation: preserve its data-preservation assertions while asserting successful repeatable PostgreSQL initialization. SQLite PRAGMA checks become real PostgreSQL schema/constraint checks. Preserve all other HTTP/UI assertions and report these database-specific adaptations transparently.

## Connection and error handling

Use one bounded application pool with connection timeout and idle error handling. Support DATABASE_URL and standard PG environment variables, without embedded credentials. Single statements use pool.query; transactions acquire one client and release it in finally. Close the pool on application shutdown. Responses and logs never include SQL error details, connection strings or passwords.

TLS configuration must retain certificate and hostname verification. Production requires TLS; local loopback Docker can explicitly disable TLS. An optional CA file supports Azure where needed. Reject insecure ssl modes and conflicting URL SSL parameters instead of allowing the URL parser to override verification. Test configuration rejection and connection refusal independently of a real Azure server. Azure connectivity remains unverified in this PR.

## Queries and contracts

Use positional parameters everywhere. Use ILIKE for existing case-insensitive title/artist/genre search and exact equality for the genre selector; combine predicates as today. Registration uses INSERT RETURNING id and handles SQLSTATE 23505 as the existing duplicate-account 400 response, including racing registrations. Login preserves bcrypt comparison and session assignment. Do not alter cookie/session architecture.

Cart insertion selects an existing product and performs ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = cart_items.quantity + 1. rowCount zero preserves the unknown-product 404. Keep ownership predicates for listing/counting/deletion/clear. Preserve camelCase cartItemId/totalItems and number types. A concurrent-request regression checks a single row and exact total quantity, including separate users.

## Local development and credentials

Add Compose with a supported, explicitly versioned PostgreSQL image (proposed major 17), loopback-bound port, required environment credentials, named volume and pg_isready health check. Supply placeholder-only .env.example and ignore .env and variants while retaining the example. Use optional Node 24 environment-file loading consistently for start/init scripts; environment-provided values take precedence. A local .env file must never be required in CI or Azure, and test commands must not load application .env files. Document Apple Silicon Colima start, Docker context verification, Compose startup/readiness, catalogue initialization, stop/restart and an explicitly destructive local volume reset. Never execute a reset against an existing user volume automatically.

## Tests and safety

Keep the existing 57 tests and their behavioral assertions, adapting only SQLite-specific setup/assertions. Require a separate TEST_DATABASE_URL pointing to a dedicated disposable test database; never fall back to DATABASE_URL or normal PG connection defaults. Create a random per-fixture schema with a validated generated identifier, configure search_path on every pooled connection, and drop only the exact schema created by that fixture. Pass test configuration explicitly to HTTP subprocesses. Missing test configuration is a hard failure, never a skip. Before any test DDL or destructive SQL, verify the explicit loopback test endpoint, dedicated database and restricted test role, and an administrator-provisioned disposable-test marker. Tests must reject application connection targets, inherited connection options and privileged roles. Provisioning uses a separate disposable test PostgreSQL instance; the test role must have no rights over development or production objects. Cleanup verifies recorded schema ownership and identity, never drops a database and never acts on public or an unregistered schema.

Add real PostgreSQL regression coverage for idempotent/concurrent initialization and rollback, constraints, catalogue and combined case-insensitive filters, registration/login/hash preservation, concurrent duplicate registration, user isolation, atomic cart increments, connection failures and sanitized diagnostics. Add guards proving test cleanup cannot target public or a schema it did not create. Keep existing DOM regression tests unchanged.

## CI and validation

Linux uses a PostgreSQL service with health checks and a dedicated test database. macOS uses a versioned Homebrew PostgreSQL installation with an ephemeral initdb directory, a loopback server, readiness polling and unconditional cleanup; no Docker services or skipped integration tests. Both jobs retain Node 24, read-only workflow permissions, persist-credentials false and locked dependency installation. Keep npm audit --audit-level=high and all mandatory check names, including the external SonarCloud check.

Write failing PostgreSQL regression tests before implementing persistence changes. After PostgreSQL behavior passes, remove sqlite/sqlite3 and native rebuild steps, regenerate the lockfile and run npm ci, npm audit --audit-level=high and the complete npm test suite. Validate Compose startup when tooling is available. Publish a draft PR only after local verification and then inspect Linux/macOS checks and the SonarCloud quality gate at the actual PR head. Clearly report unverified environments or failing checks; do not infer Azure or Colima success from CI.

## Review focus

- Numeric price/SUM parsing and quoted camelCase aliases must preserve JSON contracts.
- TLS URL parsing must not override certificate verification.
- Test database selection and schema cleanup must be safe even on setup failure.
- Reinitialization and concurrent requests must not overwrite data or lose increments.
- Native macOS PostgreSQL setup must run the full suite and always stop its server.

## Primary references

- https://node-postgres.com/features/pooling — pool.query for single statements, mandatory release for acquired clients.
- https://node-postgres.com/features/ssl — connection-string SSL parameters can replace explicit SSL configuration.
- https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers — GitHub service containers require Linux runners.

## Review status

The user approved this design on 2026-10-14, with explicit requirements for strict destructive-test isolation, safe numeric JSON conversion, and environment-only configuration without a required .env file. Those requirements are incorporated above. The design is not evidence of implementation. The detailed implementation plan requires separate review and approval; implementation, dependency installation, branch creation and PR publication remain pending. No PR may be created at the planning stage.
