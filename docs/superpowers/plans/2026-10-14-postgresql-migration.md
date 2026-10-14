# PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SQLite persistence with PostgreSQL while preserving the 57 existing behavioral tests, API contracts and security protections, and provide reproducible local and CI environments.

**Architecture:** Existing Express controllers use one native node-postgres pool. Initialization is transactional and repeatable; tests create private schemas only inside a separately provisioned disposable PostgreSQL instance. Explicit conversion at JSON boundaries preserves number types without silently losing integer precision.

**Tech Stack:** Node.js 24, Express 4, `pg`, PostgreSQL 17, existing bcryptjs/express-session, node:test, Docker Compose/Colima, GitHub Actions and existing SonarCloud integration.

**Spec:** [Approved design](../specs/2026-10-14-postgresql-migration-design.md).

**Status:** Prepared for review on 2026-10-14. No implementation steps are authorized until the user approves this plan. No branch, dependency installation, infrastructure provisioning, commit, push or PR creation is performed during planning. Recommended execution method after approval: native, sequential implementation with `superpowers:executing-plans`; alternative: subagent-driven execution if the user chooses it.

## Global Constraints

- Node.js 24; PostgreSQL 17 locally and in Linux/macOS CI; preserve Express 4 and session/authentication architecture.
- Preserve the 57 existing tests and behavioral assertions; adapt only SQLite-specific setup and schema assertions, with an explicit adaptation record.
- Use parameterized SQL, enforced foreign keys, unique email/username and unique `(user_id, product_id)`.
- Preserve fictional catalogue IDs/images and bcrypt hashes. Never open/import existing personal SQLite files or commit real accounts, credentials or database files.
- Strictly prevent destructive tests from targeting development or production databases. No application connection fallback; no database-wide reset or DROP DATABASE in the suite.
- Preserve JSON numbers through explicit safe conversion; no global numeric parser override, permissive parseFloat, or unsafe bigint-to-number conversion.
- Support DATABASE_URL and standard PG environment variables. Optional `.env` loading must preserve externally supplied values; CI/Azure require no `.env` file. Tests never load the application `.env`.
- Certificate and hostname verification remain enabled for TLS. Never use rejectUnauthorized false or insecure SSL connection-string modes.
- Preserve mandatory checks `test`, `test-macos`, `SonarCloud Code Analysis`, Node 24, `npm audit --audit-level=high`, security hardening and DOM XSS tests. No skips of macOS integration tests.
- No Azure provisioning/deployment, Sentry, payments, UI rewrite, ruleset/Sonar rule changes, history rewrite or merge.
- At this stage produce planning documents only. Later approved execution may create an English draft PR with title `feat: migrate database from SQLite to PostgreSQL`; never merge it.

## Review Focus

1. A test URL points at an application database, includes injected connection options, or authenticates as a privileged role: fail before any DDL (Task 2).
2. Cleanup follows a failed setup, a renamed/recreated schema, or another fixture's schema: act only on its registered schema OID and owner; preserve everything else (Task 2).
3. NUMERIC/BIGINT results are invalid, non-finite or exceed safe integer bounds: reject conversion; do not emit a string, rounded integer or JSON null (Tasks 1 and 5).
4. DATABASE_URL SSL parameters override explicit configuration or `.env` is absent: reject unsafe TLS configuration; accept valid environment-only configuration (Tasks 1 and 7).
5. Initialization races or macOS startup fails: preserve data and transaction ownership; fail CI and always terminate the ephemeral server (Tasks 3 and 7).

## File map and interfaces

All paths below are relative to the repository root `vinyl-shop-fullstack-auth/`, not its workspace wrapper.

| File | Responsibility |
| --- | --- |
| `db/config.js` (new) | Parse and validate connection/TLS configuration without logging secrets. |
| `db/db.js` | Export `createDatabase(config)`, lazy `getDatabase()` and `closeDatabase()` around one pool. |
| `db/values.js` (new) | Export safe field-specific JSON number conversions. |
| `db/init.sql`, `scripts/init-db.js` | PostgreSQL DDL/catalogue and repeatable initializer/CLI. |
| `controllers/{products,auth,me,cart}Controller.js` | Native pg queries and unchanged HTTP behavior. |
| `server.js`, `logTable.js` | Pool shutdown and migrated current-user/debug access. |
| `test-support/postgresql.js` (new) | Guarded test connection, per-fixture schema lifecycle and test-only privileges. |
| `test-support/http.js` | HTTP subprocess fixture using explicit isolated schema configuration. |
| `test/{database,api,reliability-api}.test.js` | Existing integration tests with PostgreSQL setup. |
| `test/{postgresql-config,postgresql-isolation,postgresql-regression}.test.js` (new) | Configuration/conversion, isolation and PostgreSQL-specific regressions. |
| `compose.yaml`, `.env.example`, `.gitignore` | Separate local development/test instances and optional environment configuration. |
| `scripts/start-test-postgres.sh` (new), `test-support/provision-test-db.sql` (new) | Start a new ephemeral native instance and bootstrap its restricted test role/marker. |
| `.github/workflows/api-tests.yml` | Linux service and native macOS integration environment. |
| `package.json`, `package-lock.json` | pg addition, SQLite removal, optional environment loading. |
| `README.md`, `docs/postgresql-migration.md` | Setup, reset, schema/API differences, results and limitations. |

Public internal interfaces (JavaScript with documented shapes):
- `databaseConfig(env = process.env): PoolConfig` in `db/config.js`; explicit, validated config, no default credential. DATABASE_SCHEMA defaults to public for normal application use; explicit schema names must be single validated identifiers. Fixtures supply only their generated schema, without public in search_path.
- `createDatabase(config): Database` in `db/db.js`, where Database exposes `query(text, values = []): Promise<QueryResult>`, `transaction(work): Promise<T>` and `close(): Promise<void>`; transaction callback receives a checked-out pg client.
- `getDatabase(): Database` lazily creates the single application pool; `closeDatabase(): Promise<void>` ends it once.
- `priceNumber(value: string | number): number` accepts only finite values representable within NUMERIC(10,2); `integerNumber(value: string | number): number` accepts only safe integers; `countNumber(value: string | number | null): number` maps only null to zero, otherwise requires a nonnegative safe integer.
- `initializeDatabase(database: Database): Promise<void>` creates/seeds its configured schema transactionally; CLI obtains configuration from `databaseConfig` and closes its database.
- `testTarget(env): PoolConfig` validates test selection; `postgresFixture(t): Promise<TestFixture>` returns `{ database, schema, directory, childEnv }`. `directory` remains a private temporary directory for HTTP process isolation. `childEnv` sets DATABASE_URL to the validated restricted test target and DATABASE_SCHEMA to the generated schema, plus required process/runtime values; it never inherits application connection settings or the parent environment wholesale. Fixture-owned cleanup is registered with `t.after` and is not exposed as an arbitrary drop helper.

## Task 0: Establish the implementation baseline (after approval only)

**Files:** Approved design/plan retained; no product change.

- [ ] Inspect applicable AGENTS.md, git status and attached worktrees. Preserve `.DS_Store` and all unrelated changes. Read the worktree skill before choosing an isolated checkout; reuse a suitable existing checkout if safe.
- [ ] Fetch `origin/main`, confirm PR #6 merged and compare current remote main with the previously verified `3abc50675c00f46156baeba615219ea962d6cb54`. If main moved, inspect the diff before adopting it. Create `feat/postgresql-migration` from the verified merged baseline without resetting another branch.
- [ ] Run Node version check and `npm test` against the baseline with local socket access; expected 57 pass, zero failures/skips. Previously this passed after the sandbox EPERM socket restriction was lifted. Record new results at the actual baseline.
- [ ] Record the 57 test names and assertions in the migration documentation's adaptation checklist. No production/development DB connection or data migration is needed for this step.

## Task 1: Validated pg configuration, pool lifecycle and safe values

**Files:** Create `db/config.js`, `db/values.js`, `test/postgresql-config.test.js`; modify `db/db.js`, `package.json`, `package-lock.json`.
**Interfaces:** Produces the config, Database and value interfaces above; no controllers switch yet. Pool max 5 per process, connection timeout 5000 ms, idle timeout 10000 ms.

- [ ] Write failing configuration/conversion tests first. Representative assertions:

```js
assert.equal(priceNumber('44.99'), 44.99)
assert.equal(countNumber(null), 0)
assert.equal(integerNumber('9007199254740991'), Number.MAX_SAFE_INTEGER)
for (const value of ['NaN', 'Infinity', '', '12x', '1e2']) {
  assert.throws(() => priceNumber(value))
}
assert.throws(() => countNumber('9007199254740992'))
assert.throws(() => integerNumber('1.5'))
assert.throws(() => databaseConfig(unsafeTlsEnv))
assert.doesNotThrow(() => databaseConfig(validEnvironmentOnlyConfig))
```

Cover decimal range/cent precision, empty/boolean/null input, negative counts, URL-versus-PG-field precedence, missing credentials, remote TLS requirement, production TLS enforcement, CA-file errors, URL SSL overrides and sanitized errors. Tests must never print configuration values.
- [ ] Run `node --test test/postgresql-config.test.js`; confirm expected missing-interface/behavior failures before implementation, not syntax errors. Add the locked current `pg` version only after these red tests exist; verify its official API/security compatibility during execution.
- [ ] Implement `databaseConfig`, value converters and Database interfaces. Use pool.query for single queries; transaction BEGIN/work/COMMIT and ROLLBACK use the same acquired client with release in finally. Idle-client errors produce a fixed diagnostic; a failed rollback destroys the client. Do not pass raw errors or config to logs. Keep app config free of test-specific privileges/helpers.
- [ ] Add lifecycle tests for real loopback connection refusal with a bounded timeout and, once Task 2 supplies a server, rollback and subsequent client reuse. Capture failure diagnostics and assert they contain neither the configured password nor URL, SQL or raw pg error text. Verify focused config tests pass. Commit these files explicitly with `feat: add PostgreSQL connection configuration and safe values`.

## Task 2: Fail-closed disposable test infrastructure

**Files:** Create `test-support/postgresql.js`, `test-support/provision-test-db.sql`, `test/postgresql-isolation.test.js`, `scripts/start-test-postgres.sh`, `compose.yaml`, `.env.example`; modify `.gitignore`.
**Interfaces:** Produces `testTarget` and `postgresFixture`; consumes Task 1 Database. Bootstrap runs only against a newly created disposable server, outside the test suite.

- [ ] Write guard tests before any destructive integration test. Assert missing TEST_DATABASE_URL, development/production names, non-loopback hosts, URL query/fragment options, application-target equality and privileged login all reject. Use dependency spies only for the no-network/no-DDL safety boundary, not to stand in for PostgreSQL behavior.

```js
assert.throws(() => testTarget({ DATABASE_URL: appUrl }))
assert.throws(() => testTarget({ TEST_DATABASE_URL: developmentUrl }))
assert.throws(() => testTarget({ TEST_DATABASE_URL: remoteUrl }))
assert.throws(() => testTarget({ TEST_DATABASE_URL: optionInjectionUrl }))
```

- [ ] Run `node --test test/postgresql-isolation.test.js` for the guards; confirm red before implementation. Implement URL-only test selection: exact `127.0.0.1` or `::1`, explicit port, database `vinyl_shop_test`, user `vinyl_shop_test`, no URL parameters. Reject a canonical endpoint/database match with DATABASE_URL or the configured application PG target; credentials cannot make the same target safe. Ignore inherited PGOPTIONS/service files/PG defaults by constructing explicit pg config.
- [ ] Add development Compose service on loopback port 5432 with a named persistent volume; add opt-in `test` profile service on loopback port 15433 with disposable storage and a separate PostgreSQL process. Credentials come from required environment variables, never literals. Include health checks. Do not mount application data into the test service. Test bootstrap creates the fixed dedicated test DB, restricted login and an admin-owned marker in `vinyl_test_control`; test login has CONNECT/CREATE only there, no superuser/createdb/createrole/replication/bypassrls or elevated role membership, and no ownership/create rights in public or the control schema. Bootstrap authority must not be available to test processes.
- [ ] Before any test DDL, query current_database/current_user, role flags/memberships, database owner and privileges and the admin-owned disposable marker. Reject mismatches; require the admin-owned database and marker plus restricted role. Naming and NODE_ENV alone never authorize destructive tests. Native startup creates a new private mktemp cluster, refuses an existing data directory and uses the same bootstrap contract. Bootstrap secrets are generated or supplied outside Git, passed safely to SQL without shell interpolation, and never echoed. Provisioning failures leave no reusable partially trusted instance.
- [ ] Implement fixtures: generate `vinyl_test_<32 lowercase hex>` schema, record returned schema OID/owner after CREATE, and scope every connection to that schema using explicit startup options with no public fallback. On teardown stop the HTTP child first, end its pool, then verify registered OID/owner before dropping exactly that schema; remove temporary files last. Register cleanup before initialization. If identity changed, fail cleanup without dropping anything.
- [ ] Add real isolated-server tests: another fixture's sentinel survives cleanup; rejected role/marker makes no DDL changes; setup failure cleans only created resources; renamed/recreated schemas are never dropped; public/control objects are inaccessible for destructive SQL; inherited application config cannot redirect the HTTP child. Confirm guards run without a server and integration tests fail explicitly if the test instance is absent—never skip.
- [ ] Run the guarded tests against the newly provisioned disposable service, verify test instance and schema separation, and commit explicit files with `test: isolate PostgreSQL fixtures behind strict safety guards`.

## Task 3: Transactional repeatable schema and catalogue initialization

**Files:** Modify `db/init.sql`, `scripts/init-db.js`, `test/database.test.js`; create initialization cases in `test/postgresql-regression.test.js`.
**Interfaces:** Produces `initializeDatabase(database)`; consumes Database.transaction and postgresFixture. No file path argument or SQLite import remains in initializer.

- [ ] Adapt the five existing database tests first: PostgreSQL metadata replaces sqlite_master/PRAGMAs; RETURNING replaces lastID; repeat initialization replaces EEXIST while preserving all account/cart/catalogue data-preservation assertions. CLI test runs in the fixture's private directory with only `childEnv` and no `.env`. Add failing idempotence, parallel initialization, rollback, identity sequence and incompatible-schema tests.

```js
await initializeDatabase(database)
const before = await snapshotFixtureRows(database)
await initializeDatabase(database)
assert.deepEqual(await snapshotFixtureRows(database), before)
await Promise.all([initializeDatabase(database), initializeDatabase(database)])
assert.equal(await catalogueCount(database), 10)
```

`catalogueCount`/`snapshotFixtureRows` are private test helpers querying this fixture only; snapshot includes an edited product, a synthetic hashed user and cart row.
- [ ] Run `node --test test/database.test.js test/postgresql-regression.test.js`; confirm the initializer/schema regressions fail for PostgreSQL behavior. No test helper may bypass Task 2 guards.
- [ ] Implement PostgreSQL identities, NUMERIC(10,2), TIMESTAMPTZ, unique/FK constraints and existing nullable columns. Keep seed rows verbatim. Hold a transaction advisory lock tied to the target schema; validate existing tables/types/constraints before seeding. Seed only missing IDs; align identity sequence to at least max ID/current sequence without decrementing it. Do not put independent BEGIN/COMMIT statements into init.sql.
- [ ] Confirm failure rolls back DDL/seed, acquired client is reusable, repeated init preserves byte-for-byte bcrypt hash, no orphan/duplicate row is accepted, and generated IDs avoid seeded IDs. CLI prints catalogue-only success or fixed failure diagnostic and closes the pool. Commit with `feat: initialize PostgreSQL schema and fictional catalogue`.

## Task 4: Catalogue and authentication query migration

**Files:** Modify `controllers/productsController.js`, `controllers/authController.js`, `controllers/meController.js`, `test/api.test.js`, `test/reliability-api.test.js`, `test-support/http.js`; extend `test/postgresql-regression.test.js`.
**Interfaces:** Controllers consume getDatabase/query plus priceNumber/integerNumber; HTTP fixture returns existing client API and new fixture database handle instead of SQLite filename.

- [ ] Switch fixture setup to postgresFixture and initializeDatabase; replace direct SQLite inspection with native fixture queries and explicit conversions in tests where PostgreSQL COUNT values are strings. Preserve every existing HTTP assertion and all 14 API test names. Launch child in its private directory with only explicit config, PORT=0 and synthetic session secret; never spread process.env.
- [ ] Add failing mixed-case combined searches, SQL-looking input, simultaneous duplicate registration and no-.env startup cases. Assert catalogue prices/IDs/year/stock keep their exact types, hashes remain bcrypt-valid, /me behavior stays unchanged, duplicate loser returns existing 400 error and receives no authenticated session. For concurrent registration use independent cookie clients and assert exactly one user in the fixture DB.
- [ ] Run `node --test test/api.test.js test/reliability-api.test.js test/postgresql-regression.test.js`; inspect catalogue/auth failures before migrating queries. Cart failures remain explicitly expected until Task 5, not waived as a final result.
- [ ] Implement `$n` placeholders, ILIKE search with exact genre filtering, INSERT RETURNING id and 23505 duplicate mapping. Migrate `/me` and sanitize auth/current-user log messages. Preserve registration/login/logout/session behavior. Query rows/rowCount directly; no SQLite compatibility adapter.
- [ ] Run focused catalogue/auth test names and config tests, record passing results, and commit with `feat: migrate catalogue and authentication queries to PostgreSQL`. Keep the expected cart failures tracked for Task 5.

## Task 5: Atomic cart queries and numeric HTTP regression coverage

**Files:** Modify `controllers/cartController.js`, `test/reliability-api.test.js`; extend `test/postgresql-regression.test.js`.
**Interfaces:** Uses getDatabase and priceNumber/integerNumber/countNumber. Preserve `cartItemId`, `totalItems`, status codes and error strings.

- [ ] Retain existing 12-request mixed numeric/string cart addition regression. Add failing larger concurrency and simultaneous two-user cases, direct constraint checks and numeric overflow failure. Assert one line per user/product and exact increments, no orphan rows, foreign deletion stays 400 and unknown product remains 404. Test a SUM above Number.MAX_SAFE_INTEGER via synthetic schema-local rows; assert sanitized 500, not rounded data.
- [ ] Run the cart tests and confirm red before implementation. Implement one INSERT SELECT from products with ON CONFLICT (user_id, product_id) DO UPDATE increment; rowCount zero maps to 404. Use owned DELETE/clear/list/count queries and quoted camelCase aliases. Convert price and COUNT/SUM explicitly; null aggregate alone maps to zero.
- [ ] Preserve accepted positive safe IDs above PostgreSQL int32 range: non-existent product stays 404 and missing cart item stays 400 without passing an out-of-range parameter into an integer comparison. Add boundary tests for 2147483648 and Number.MAX_SAFE_INTEGER. No change to malformed-ID 400 behavior.
- [ ] Run complete `npm test` with verified disposable configuration. Expected all original 57 tests plus additions pass, no failures/skips, and unchanged DOM/UI test files. Commit with `feat: preserve cart contracts with atomic PostgreSQL additions`.

## Task 6: Remove SQLite and finish runtime lifecycle

**Files:** Modify `package.json`, `package-lock.json`, `server.js`, `logTable.js`; extend configuration/lifecycle regression tests.
**Interfaces:** Runtime shutdown and debug utility use closeDatabase; no getDBConnection call sites remain.

- [ ] Add failing shutdown regression: terminate HTTP fixture, wait for exit and verify its PostgreSQL sessions close before schema cleanup. Add a CLI debug test in the private fixture with synthetic rows; output may include the existing cart fields but must never include accounts, hashes or configuration secrets.
- [ ] Implement orderly HTTP server/pool shutdown on SIGTERM/SIGINT and migrate logTable's fixed cart query. Preserve session options. Remove sqlite/sqlite3 only now, update lockfile and remove native rebuild/runtime checks. Keep historical documentation and ignored local SQLite files untouched.
- [ ] Run `npm ci`, `npm audit --audit-level=high`, `npm test`; require zero high/critical vulnerabilities and no failing/skipped tests. Search runtime/test sources for SQLite dependencies and obsolete getDBConnection calls; expected none. Commit explicit files with `chore: remove SQLite runtime and close PostgreSQL pools`.

## Task 7: Environment-only local setup and Linux/macOS CI

**Files:** Modify `package.json`, `compose.yaml`, `.env.example`, `.github/workflows/api-tests.yml`, `scripts/start-test-postgres.sh`; extend `test/postgresql-config.test.js`/isolation tests as needed.
**Interfaces:** start/db:init accept optional .env; npm test requires explicit test environment; native helper starts a private server and exports only test config to its child command.

- [ ] Add no-.env CLI regressions for `npm start` and `npm run db:init` using only explicit fixture environment. Assert an externally supplied value wins over a conflicting local example value. Test commands must not read `.env`; verify NODE_ENV=test alone cannot select application connection defaults.
- [ ] Use Node 24 `--env-file-if-exists=.env` for app/init scripts after verifying precedence in tests. Compose consumes supplied shell variables or optional local .env, with no default password. Document TEST_DATABASE_URL as a secret value, never print it.
- [ ] Preserve workflow job IDs and check names. Linux provisions PostgreSQL 17 service, bootstraps restricted role/marker with service admin credentials in a dedicated step and passes only restricted credentials to npm test. Replace native SQLite steps; retain Node 24, read-only permissions, persist-credentials false, locked install and high-level audit.
- [ ] macOS installs/locates Homebrew postgresql@17, creates a new private initdb cluster and loopback port, uses bounded pg_isready polling, bootstraps the same test role/marker, and runs the same npm test command. Keep startup/test/cleanup in a trap-managed script; no trust auth on TCP, no reuse of a workstation cluster, and no service-container syntax. Test start failure returns nonzero and cleanup removes only the generated temporary directory. Adjust job timeout to 20 minutes if needed for native installation.
- [ ] Validate Compose rendering without emitting secrets, local service health, init/catalogue/auth/cart flows and reset instructions using only new disposable volumes. Validate native startup and cleanup locally if tooling permits. Do not install missing host tooling without documenting the need; do not claim local Colima success from Linux CI. Workflow execution/required checks can only be verified after the later draft PR exists.
- [ ] Commit explicit configuration/CI files with `ci: run PostgreSQL integration tests on Linux and macOS`.

## Task 8: Documentation, final checks and later draft PR

**Files:** Create `docs/postgresql-migration.md`; modify `README.md` and this plan's completed checkboxes during execution.

- [ ] Document schema mapping, unique/FK behavior, monetary/aggregate JSON conversion, idempotent initialization, transaction/pool lifecycle, TLS/CA/DATABASE_URL rules and Azure environment-only setup. No live Azure connectivity or readiness claim.
- [ ] Document Apple Silicon Colima start and Docker context, Compose dev/test startup, synthetic credentials supplied outside Git, readiness, init/seed, stop/restart and deliberate dev-volume reset. Clearly label reset as destructive and never run it on an existing developer volume. Explain dedicated disposable test service/role/marker and fail-closed errors. Update active README SQLite instructions/badge while preserving historical change records.
- [ ] Record the baseline 57 assertions, five database test adaptations, added regressions, commands/results and unsupported environments. Run `npm ci`, `npm audit --audit-level=high`, `npm test` once at final head after all changes; inspect diff for scope, secrets, dependency changes, unchanged DOM protections and unchanged session architecture. No repeated broad runs unless changes/failures justify them.
- [ ] Only after this plan's approval and implementation/local verification, push `feat/postgresql-migration` and create an English **draft** PR targeting main with the required title. Include architecture/schema/dependency/test changes, actual Linux/macOS/audit/Sonar results and remaining limitations. Attach the PR to this chat. No PR is created during this planning turn.
- [ ] Inspect `test`, `test-macos`, `SonarCloud Code Analysis` and the SonarCloud quality gate against the current PR head. Update English description with real results and links; report any failures/blocked checks explicitly. Stop for repository owner review. Never merge or enable auto-merge.

## Plan self-review

Coverage checked: schema/catalogue/constraints → Task 3; pooling/TLS/transactions → Task 1; all four controllers and utilities → Tasks 4–6; strict isolation → Task 2; optional environment files → Tasks 1/7; Linux/macOS/security → Tasks 6–7; all requested documentation, final checks and draft PR → Task 8. Every Review Focus item has an owning task and regression assertions. No approval is inferred from this document: design approval allows this plan, and only separate plan approval allows execution. Environment availability and remote CI/Sonar results remain unverified until execution.
