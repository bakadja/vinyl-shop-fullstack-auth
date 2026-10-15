# Secure and Persistent Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist secure authentication sessions in PostgreSQL and ship the explicitly approved POST-only logout contract in PR #8.

**Architecture:** Keep express-session and the single caller-owned pg pool, adding connect-pg-simple and explicit session-table initialization. Validate configuration before listening, enforce fixed eight-hour authentication, await regeneration/save, and reject unsafe production transport. Exercise production behavior with local TLS fixtures; Azure topology remains unverified.

**Tech Stack:** Node.js 24, Express 4, express-session 1.18.2 baseline, pg 8.23.1 baseline, PostgreSQL 17, connect-pg-simple (review candidate 10.0.0), node:test; proposed development-only Playwright Chromium for browser cookie evidence; OpenSSL for disposable test certificates.

**Spec:** [Approved specification with POST-only amendment](../specs/2026-10-15-secure-sessions-design.md).

**Status:** Approved by the human for native sequential execution on2026-10-15. Implementation and local validation completed; final independent review in progress. The original planning boundary below is retained as historical context. All checkboxes below are future work. No application changes, dependency installation, branch creation, commit, push or PR publication are performed while preparing this plan. Spec approval authorizes this document only. Recommend native sequential execution because tasks share configuration, pool and fixture interfaces; the human may choose subagent-driven execution instead. Publication requires a later instruction.

## Global Constraints

- Node.js 24; Express 4; PostgreSQL 17; preserve Linux/macOS integration testing and existing security gates.
- Use connect-pg-simple with the existing caller-owned PostgreSQL pool; never fall back to MemoryStore or introduce Redis.
- Fixed eight-hour sessions: `28_800_000` milliseconds / `28_800` seconds; `saveUninitialized:false`, `resave:false`, `rolling:false`, `disableTouch:true`.
- `SPIRAL_SESSION_SECRET`: canonical 64-character hex encoding of 32 cryptographically random bytes; no fallback. Up to two distinct previous verification keys; current signs, all verify.
- Production cookie: `__Host-vinyl.sid`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. Development/test HTTP: `connect.sid`, Secure=false, other attributes unchanged.
- Session table: validated DATABASE_SCHEMA, fixed `user_sessions`, sid varchar PK / sess json NOT NULL / expire timestamp(6) NOT NULL and expiry index; UTC connection policy; explicit initialization, no runtime DDL.
- Registration/login: regenerate, assign identity, explicitly save, then success; never report successful authentication after a persistence failure.
- Approved contract amendment: POST `/api/auth/logout`; GET and HEAD return405 with Allow: POST and do not mutate authentication. Include trailing-slash paths. Preserve success/error JSON for POST.
- Preserve coverage of all 88 baseline tests and unrelated assertions; adapt only affected logout contract expectations plus necessary setup. Add coverage rather than deleting or skipping cases.
- Preserve restricted disposable database guards, administrator marker, private fixture schemas, atomic name/OID/owner cleanup and child-before-schema shutdown. No application database fallback or production-target destructive tests.
- Preserve verified PostgreSQL TLS; never use rejectUnauthorized=false, sslmode=require/no-verify or production-only test bypasses.
- Azure proxy topology remains unverified until deployment evidence is available. No invented CIDRs, blanket proxy trust, provisioning, deployment, Sentry, payments, checkout, unrelated frontend changes, ruleset changes or merges.

## Review Focus

1. A real production-mode fixture must complete verified PostgreSQL TLS without weakening test-target validation or skipping production assertions (Tasks 2, 4, 8).
2. Duplicate/mixed-case forwarding headers or IPv4-mapped socket addresses must not bypass the immediate-peer/HTTPS boundary (Tasks 1, 4).
3. Session INSERT commits but its callback reports failure: no 2xx, no authenticated cookie, no response-end auto-save or user/cart deletion (Task 5).
4. An in-flight prune or repeated signal overlaps shutdown: stop the timer, drain store queries, close the shared pool once, and exit within10s (Tasks 3, 4).
5. GET/HEAD logout, cookie-jar deletion and a separately retained raw cookie must demonstrate rejection without mutation and actual server-side POST invalidation (Tasks 2, 6).

## File structure and contracts

All paths below are repository-relative under `vinyl-shop-fullstack-auth/`. Keep the current module style (ESM, node:test). Do not restructure unrelated controllers.

| Files | Responsibility |
| --- | --- |
| Create `sessions/config.js` | Pure environment/secret/cookie policy, origin normalization and proxy-range compilation |
| Create `sessions/transport.js` | Production immediate-peer and raw forwarded-protocol checks |
| Create `sessions/store.js` | Store factory, tracked store-query lifecycle, sanitized pruning diagnostics |
| Create `sessions/schema.js`, `db/sessions.sql`, `scripts/init-sessions.js` | Shared read-only table validation and explicit locked initializer/CLI |
| Create `sessions/authentication.js`, `sessions/policy.js` | Awaited authentication transition, failure cleanup, expiry, cookie clearing, logout Origin/Fetch Metadata policy |
| Modify `db/db.js`, `db/config.js` | Narrow native-pool accessor and UTC session setting; preserve existing query/transaction/TLS behavior |
| Modify `server.js` | Validate/readiness before listening, middleware composition, bounded shutdown |
| Modify `controllers/authController.js`, `controllers/meController.js`, `routes/auth.js` | Authentication transition, missing-user invalidation, POST-only logout |
| Modify `public/js/logout.js` | POST JSON logout; preserve disabled-button/error/redirect behavior |
| Modify `test-support/http.js`; create `test-support/session-process.js` | Additive raw-cookie/header/restart/multi-worker harness, allowlisted environments |
| Create `test-support/tls.js`, `test-support/create-test-certificates.js`, `scripts/configure-ci-test-tls.js` | Disposable CA/cert generation, local TLS proxy and Linux service TLS configuration |
| Modify `scripts/start-test-postgres.sh`, `.github/workflows/api-tests.yml` | TLS-capable private PG17 cluster / existing Linux PG17 service; mandatory Chromium setup |
| Create `test/session-{config,schema,store,transport,authentication,logout,persistence,browser}.test.js` | Targeted unit, real PG17, process and browser regression coverage |
| Modify `test/api.test.js`, `test/reliability-ui.test.js`, `test/postgresql-regression.test.js` | Approved logout adaptation, frontend assertions, strong-key/session-init startup setup |
| Modify `package.json`, `package-lock.json`, `.env.example`, `README.md`; create `docs/secure-sessions.md` | Reviewed dependencies, session-init command, configuration/rotation/API migration documentation |

Public internal interfaces (document these shapes in JSDoc; do not add TypeScript):

- `sessionConfig(env = process.env): SessionConfig` in `sessions/config.js` returns `{ environment, secrets, schema, origin, proxyMode, trustPeer, cookieName, cookie, lifetimeMs }`. `cookie` has `{httpOnly,secure,sameSite,path,maxAge}`. `secrets` is current-first. `trustPeer(address): boolean` checks only approved ranges; normalize IPv4-mapped IPv6. Optional `SESSION_PROXY_MODE` is direct by default in development/test, verified-proxy required in production. Production PUBLIC_ORIGIN is mandatory; development defaults to `http://localhost:8000` and documents explicit override for other hosts/ports. Unknown NODE_ENV fails; absent NODE_ENV means development, matching current local startup.
- `createDatabase(config): Database` retains existing methods and adds `getPool(): pg.Pool`; `getDatabase()` and `closeDatabase()` preserve existing ownership. Export `databaseSchema(env = process.env): string` from `db/config.js` using the existing identifier validation so session and DB config cannot diverge.
- `initializeSessions(database: Database): Promise<void>` and `validateSessionSchema(queryable: {query}): Promise<void>` in `sessions/schema.js` operate only in the connection's validated current schema. CLI runs the former; readiness runs the latter without DDL.
- `createSessionStore({pool,config}): {store,close():Promise<void>}` in `sessions/store.js`. It receives the native pool; a tracked query adapter delegates to that exact pool without creating/ending another. close stops store timers and waits for already-started store queries, but never ends the pool.
- `productionTransport(config): RequestHandler` in `sessions/transport.js` rejects unsafe production requests with400 `{error:'HTTPS required'}` before parsing/session access; does nothing in direct development/test mode.
- `establishSession(req,res,userId,config,{now = Date.now} = {}): Promise<void>` in `sessions/authentication.js` regenerates, assigns userId/authenticatedAt, saves; rejects after sanitizable cleanup on failure. `clearSessionCookies(res,config): void` and `invalidateSession(req,res,config): Promise<void>` in `sessions/policy.js` centralize destroy/detach/clear behavior; destruction failure rejects after clearing the browser cookie.
- `sessionValidity(config,{now = Date.now} = {}): RequestHandler` and `logoutPolicy(config): RequestHandler` in `sessions/policy.js`. Validity precedes `/me` and cart authorization; invalid/expired identities are invalidated. Anonymous remains anonymous without a new stored session. Logout policy protects only POST logout. Export `logoutMethodGuard(req,res,next): void` from `routes/auth.js` and mount it before JSON/session middleware at the exact logout path; it rejects GET/HEAD without consulting the store, otherwise calls next.
- `fixture(t)` retains `{client,directory,database,schema,childEnv,shutdown}`. `client()` retains its original response shape `{status,body,cookie}` and adds optional request headers; use an independent raw harness for headers/multiple cookies so exact existing deepEqual assertions remain valid.
- `startSessionProcess(t,{childEnv,cwd,secret,overrides = {}}): Promise<{baseUrl,request(path,options):Promise<{status,body,headers,setCookies}>,stop(signal = 'SIGTERM'):Promise<number>}>` in `test-support/session-process.js`; overrides are test-owned explicit allowlisted values, never arbitrary parent env spreading. request supports raw Cookie, does not silently maintain a jar, and treats HEAD as body=null. Restart means stop and start another child using the same fixture schema and generated key.
- `createTestCertificates(directory): Promise<{caFile,serverCertFile,serverKeyFile}>` in `test-support/tls.js`; certificates cover localhost,127.0.0.1,::1 and have temporary files with restricted key permissions. `startTlsProxy(t,{targetUrl,certificates,overwriteProtocol = true}): Promise<{origin,close():Promise<void>}>` terminates TLS, overwrites forwarded headers in the normal path, and exposes explicit raw-forwarding test mode only inside test-support.

Do not expose clocks, failure injection or insecure TLS switches as production HTTP/env controls. All runtime request timeouts/failure diagnostics remain generic. Failure injection uses node:test mocks or directly constructed test applications/stores, never a production backdoor.

## Task 0: Establish the execution baseline after approval

**Files:** no product edits; retain the approved spec and this plan.

**Interfaces:** consumes the human's plan approval and selected execution method; produces a verified baseline SHA, test evidence and isolated execution workspace.

- [ ] Read both documents and the applicable AGENTS instructions again; verify the approved scope and logout amendment.
- [ ] Use `superpowers:using-git-worktrees` at execution time. First inspect attached worktrees and the actual remote main; do not assume the current `feat/postgresql-migration` HEAD equals merged main. Use an isolated implementation worktree from verified main after authorization, carry the approved documents without unrelated .DS_Store files, and preserve the original checkout. No publication or merge is implied.
- [ ] Run `bash scripts/start-test-postgres.sh npm test` against existing dependencies. Expected original baseline:88 passed,0 failed,0 skipped; record actual SHA/versions and diagnose discrepancies before proceeding. The prior session's88-pass result is historical evidence, not a new execution result.
- [ ] Read package metadata/artifact for connect-pg-simple10.0.0, including Store get/set/touch/prune/close and pool ownership, and verify its published Node engine range. If that exact candidate is unavailable/incompatible, stop this dependency choice for review instead of silently choosing another major version.

## Task 1: Validated configuration and proxy trust inputs

**Files:** create `sessions/config.js`, `test/session-config.test.js`; modify `db/config.js`; later integration into server belongs to Task4.

**Interfaces:** produces `sessionConfig` and `databaseSchema` exactly as above. Add direct runtime dependency `proxy-addr` (review/pin the version already resolved by Express) so CIDR handling does not import an undeclared transitive package or implement its own IP parser.

- [ ] Write configuration tests. Use cryptographically generated fixture keys, plus explicit malicious/invalid input cases. Core assertions:

```js
assert.equal(config.lifetimeMs, 28_800_000)
assert.deepEqual(config.secrets, [current, previous])
assert.equal(config.cookieName, '__Host-vinyl.sid')
assert.deepEqual(config.cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 28_800_000 })
assert.throws(() => sessionConfig({ NODE_ENV: 'production' }), /configuration/i)
```

  Cover missing/blank/noncanonical keys, previous array length>2, duplicates including current, null/nonstring entries, known placeholders, repeated single byte/two-byte patterns, unknown NODE_ENV; no input echoed by thrown messages. An entropy guarantee comes from generation, not format alone. Accept uppercase only if canonicalized to lowercase before deduplication, or reject uppercase consistently; choose rejection for this plan.
- [ ] Add proxy/origin tests: require https production origin with no credentials, non-root path, query or fragment; accept parser-canonical root URL without storing its slash. Reject empty, wildcard, `/0`, named private-subnet shortcuts and complete RFC1918/ULA ranges; permit narrow explicit CIDRs. Test IPv4-mapped IPv6 and invalid addresses, direct mode in production, empty trust list, and env attempts at insecure cookie overrides. Reject supplied SESSION_COOKIE_SECURE, SESSION_COOKIE_HTTP_ONLY, SESSION_COOKIE_SAME_SITE, SESSION_COOKIE_DOMAIN, SESSION_COOKIE_NAME and SESSION_ROLLING variables: this release has a fixed cookie policy and supports no such overrides.
- [ ] Run `node --test test/session-config.test.js`. Expected RED due to missing interfaces. Only after observing that failure, review/install the pinned dependencies using `npm install --ignore-scripts --save-exact connect-pg-simple@10.0.0` and a separately reviewed exact proxy-addr version obtained from the existing lockfile. Audit the resulting lockfile with `npm audit --audit-level=high`; do not weaken the gate. Installation is future implementation work only.
- [ ] Implement the pure parsers and constants; reuse databaseSchema from databaseConfig rather than duplicating the regex. No key logging, listeners, pool creation or dotenv loading here. Keep schema default public only for ordinary app configuration; fixtures always set their generated schema.
- [ ] Re-run configuration and existing PostgreSQL-config tests: `node --test test/session-config.test.js test/postgresql-config.test.js`. Expected all pass, including TLS/URL rejection assertions. Commit only Task1 files plus manifests/lockfile: `feat: validate secure session configuration`.

## Task 2: Explicit session schema, verified-TLS test infrastructure and process fixtures

**Files:** create `db/sessions.sql`, `sessions/schema.js`, `scripts/init-sessions.js`, `test/session-schema.test.js`, `test-support/session-process.js`, `test-support/tls.js`, `test-support/create-test-certificates.js`, `scripts/configure-ci-test-tls.js`; modify `db/config.js`, `db/db.js`, `test-support/http.js`, `scripts/start-test-postgres.sh`, `.github/workflows/api-tests.yml`, `package.json`, `test/postgresql-regression.test.js`.

**Interfaces:** consumes databaseSchema; produces schema initializer/validator, getPool, process/TLS interfaces and `npm run db:init:sessions`. `TEST_DATABASE_CA_FILE` is the test-runner-owned CA path; only production test children map it to PGSSLROOTCERT and set PGSSLMODE=verify-full / NODE_ENV=production. The restricted guard continues using its existing loopback-only credentials and target checks, and is not relaxed.

- [ ] Write schema tests against postgresFixture. Assert columns/PK/expiry index; initialize twice with live session/account/cart snapshots unchanged; concurrent calls succeed; incompatible type/nullability/PK/index or view fails atomically without replacement; another fixture's same-named table is untouched. Keep base-initializer tests expecting exactly three tables unchanged.

```js
await initializeSessions(database)
const before = await snapshotApplicationAndSessionRows(database)
await Promise.all([initializeSessions(database), initializeSessions(database)])
assert.deepEqual(await snapshotApplicationAndSessionRows(database), before)
```

  `snapshotApplicationAndSessionRows` is a test-local helper over fixed table names, not a new runtime API. Add tests that a failing migration rolls back, read-only validation performs no DDL, and timezone is UTC even when server/client defaults differ.
- [ ] Run `bash scripts/start-test-postgres.sh node --test test/session-schema.test.js`. Expected RED for missing initializer. Implement PG17 SQL without OIDS, fixed quoted table/index names, the existing advisory-lock key/current-schema pattern, catalog validation and generic CLI errors. CLI closes its owned Database in finally. Do not modify base db/init.sql or its seed/sequence behavior.
- [ ] Add getPool and UTC connection options while preserving pool max5/timeouts/TLS/search_path validation. Initializer and validator use configured current_schema; runtime will validate before listening. Fail if the configured schema does not exist, rather than creating it. Add schema DML privilege/readiness checks without mutating data during readiness.
- [ ] Extend the private native PG17 helper to generate a temporary CA/server certificate using OpenSSL, enable PostgreSQL server TLS at startup and export TEST_DATABASE_CA_FILE only to the test command. Preserve SCRAM, loopback binding, private paths, restricted role provisioning, cleanup trap and startup failure behavior. Certificate script CLI accepts only its explicit output directory and prints no key contents. Guard connections may remain plaintext loopback; production application children must use verified TLS with that CA.
- [ ] Keep the existing Linux postgres:17 service. Add a workflow step after role provisioning that runs `scripts/configure-ci-test-tls.js` with the service container ID and existing masked administrator credential in environment. It generates disposable certificates under RUNNER_TEMP, copies cert/key into that service with postgres ownership/key0600, enables ssl and reloads configuration, then proves a verify-full loopback connection before exporting TEST_DATABASE_CA_FILE. No arbitrary remote target is accepted. If reload/version behavior requires restart, perform a bounded service restart and verify readiness before running tests; do not downgrade TLS. macOS uses the upgraded native helper. No role/marker/ruleset changes.
- [ ] Add HTTP fixture session initialization and randomBytes32 keys; preserve its client result shape. Preserve raw replay separately from jar deletion. Register shutdown hooks before postgresFixture cleanup; track every worker, proxy and pending startup, and close them before schema deletion. Keep stop() idempotent. Allow actual public asset cwd for browser tests without loading .env (spawn node server.js directly with the allowlisted environment).
- [ ] Adapt the existing npm-start regression setup to call initializeSessions and use a generated strong key; keep all catalogue/startup assertions. Its base db:init environment/optional-file tests remain unchanged. Add fixture tests proving production children use a verified CA, reject wrong CA, never inherit application DB env, and preserve schema-identity cleanup when startup fails.
- [ ] Run `bash scripts/start-test-postgres.sh node --test test/session-schema.test.js test/database.test.js test/postgresql-isolation.test.js test/postgresql-config.test.js test/postgresql-startup.test.js test/postgresql-regression.test.js`. Expected green with the current server still runnable; strong keys are backward-compatible before wiring. Prove TLS with the future-production child connection settings using databaseConfig/createDatabase directly. Commit: `feat: initialize isolated PostgreSQL session storage`.

## Task 3: Persistent store and drainable ownership

**Files:** create `sessions/store.js`, `test/session-store.test.js`.

**Interfaces:** consumes getPool/config/validated schema; produces createSessionStore. No pool construction or implicit DATABASE_URL fallback in the store module.

- [ ] Write real PG tests for set/get/destroy, expired get before prune, disableTouch, prune preserving live sessions/application rows/another schema, SID parameterization and unavailable table/permission callbacks. Wrap callback methods into test-local Promises. Core assertions:

```js
assert.equal(await readExpiredSid(store), undefined)
await touchStoredSession(store, sid)
assert.equal(await readExpiry(database, sid), originalExpiry)
await prune(store)
assert.deepEqual(await applicationSnapshot(database), before)
```

  Helpers above are test-local wrappers around actual Store methods and fixed SQL. Cover sid strings containing quotes/SQL metacharacters; schema itself remains validated.
- [ ] Add deterministic lifecycle tests: caller pool end call count stays0 after store close; a gated in-flight prune keeps close pending until its query settles; new prune cannot begin after closure; repeated close shares completion; cleanup failure emits generic logs without error objects/SIDs/connection strings. Test rejection handling produces no unhandledRejection.
- [ ] Run `bash scripts/start-test-postgres.sh node --test test/session-store.test.js` and observe RED. Implement Store construction with explicit pool delegation, schemaName, tableName=user_sessions, createTableIfMissing=false, ttl28800, disableTouch=true, prune900/randomized and sanitized errorLog. Track store-only delegated query Promises so close waits for work already in flight after Store.close cancels its timer. Do not depend on private library fields or subclass private methods.
- [ ] Re-run the same command, expect all pass and no lingering timer/connection. Commit: `feat: persist sessions through the shared PostgreSQL pool`.

## Task 4: Server composition, production transport and bounded shutdown

**Files:** create `sessions/transport.js`, `test/session-transport.test.js`; modify `server.js`; extend `test/session-store.test.js` and `test/postgresql-regression.test.js` for lifecycle cases.

**Interfaces:** consumes Tasks1–3 and productionTransport; produces a server that listens only after config/table/connection readiness. Retain the fixture's existing startup announcement pattern for compatibility; do not print keys/URLs.

- [ ] Write process tests for missing/invalid config, missing session table, inaccessible DB, wrong CA and incompatible schema: nonzero exit, no readiness announcement/listener, generic diagnostics and no leaked sentinel credentials. No runtime creation of missing tables. Existing sanitized API JSON/error middleware behavior stays intact.
- [ ] Write productionTransport tests with actual socket peers: trusted127.0.0.1 when the configured range is127.0.0.1/32, and the same actual127.0.0.1 peer untrusted when that child trusts only::1/128. This needs no extra loopback alias or conditional skip; add deterministic direct middleware tests for mapped-address cases too. Raw node:http tests use raw header pairs for duplicate/mixed-case X-Forwarded-Proto. Assert HTTP/missing/multiple/list/unknown proto and untrusted peer+https all return400, no Set-Cookie and no DB writes. Normal local TLS proxy overwrites forged input and produces trusted https; unsafe raw-forwarding mode proves the application's rejection. Compare Host/X-Forwarded-Host forgery to the fixed origin, never to an inferred origin.
- [ ] Run `bash scripts/start-test-postgres.sh node --test test/session-transport.test.js` and observe RED. Wire config -> existing pool -> read-only validate -> store -> middleware -> listener. Set trust proxy to the compiled immediate-peer predicate, leave middleware proxy override unset. Order: production transport guard, explicit GET/HEAD logout rejection (Task6 adds the route rule), JSON parser, session middleware, validity (Task5), routers/error handler. Transport failure has its own fixed400 response, not the invalid-JSON error string.
- [ ] Make SIGINT/SIGTERM enter one memoized shutdown Promise: stop accepting/drain HTTP, close Store/drain store queries, closeDatabase once. Total deadline10,000ms; on timeout terminate connections, emit generic failure and exit nonzero. Test waiting on a controlled in-flight cart lock (retain the existing test), in-flight prune, repeated signals and a deadline via injectable shutdown clock/timer in tests, without a runtime environment bypass. Startup failure closes whatever was constructed.
- [ ] Re-run transport/store/existing PostgreSQL regression tests. Expect green; full auth tests may await Task5's policy layer, but no assertion is removed to hide a failure. Commit: `feat: enforce production session transport and lifecycle`.

## Task 5: Authentication transitions and fixed expiry

**Files:** create `sessions/authentication.js`, `sessions/policy.js`, `test/session-authentication.test.js`, `test/session-persistence.test.js`; modify `controllers/authController.js`, `controllers/meController.js`, `server.js`.

**Interfaces:** consumes config/store/fixture; produces establishSession, sessionValidity, clearSessionCookies and invalidateSession. Handlers obtain the validated config from `req.app.locals.sessionConfig` after the credential/database operations succeed; direct existing controller error tests still reach their database failures without requiring a fake Express app. Do not read mutable env per request.

- [ ] Write fixation tests for login and registration: start with a valid stored SID, authenticate as another account, capture new SID, replay the old raw cookie and get anonymous /me plus cart401. Add a stored anonymous-session case via controlled test setup, not a runtime anonymous-session creation endpoint. Assert no stale session properties copied and userId comes only from the database result.
- [ ] Write delayed/failing regenerate/save cases, including commit-then-error, destroy-old failure and cleanup failure. Assert success is withheld while callback pending; failure500 uses existing per-controller JSON; no authenticated Set-Cookie; no response-end resave; retained inserted user but unchanged carts; sanitized logs. Verify invalid credentials leave an existing legitimate identity intact and do not call regenerate/save.
- [ ] Write persistence/expiry/rotation tests using real children and the same schema/key across restarts and two concurrent workers. Replay old cookie across current/previous signing phases and reject after old verification key removal; verify new signatures using middleware-compatible signing verification without printing keys. Backdate both row expiry and authenticatedAt separately. Tests cover exact deadline, future/malformed/missing authenticatedAt, invalid/nonpositive/unsafe userId, non-UTC DB defaults and no extension on repeated /me/cart reads.

```js
assert.notEqual(afterSid, beforeSid)
assert.deepEqual((await oldCookieMe()).body, { isLoggedIn: false })
assert.equal((await oldCookieCart()).status, 401)
assert.equal((await loginWithInjectedSaveFailure()).status, 500)
assert.equal(await countAccountRows(database, username), 1)
```

  Helpers are local to the named tests. Keep authenticatedAt as integer epoch milliseconds; reject values later than now (no implicit future grace). Clock injection is only a constructor/test option, never a request/env override.
- [ ] Run `bash scripts/start-test-postgres.sh node --test test/session-authentication.test.js test/session-persistence.test.js` and observe RED. Implement regenerate -> assign -> explicit save sequencing. On failure capture SID before detaching req.session, delete the candidate SID best-effort through sessionStore.destroy, clear cookies and rethrow; do not permit auto-save retries. Deleting the account as compensation is forbidden. Set cookie expiry to authenticatedAt+lifetimeMs before save; middleware/store timestamp rounding must never override the application authorization deadline. Cap any later authenticated Store.set expiry at that same deadline through the public set boundary, preserving the callback contract. Ordinary sessions remain read-only; no rolling/touch.
- [ ] Mount validity before `/me` and cart authorization. Invalid/expired identity is detached/cleared and destroyed; successful invalidation yields anonymous /me/cart401, destroy failure yields sanitized500 and never permits protected action. Missing user in /me invalidates to anonymous; DB lookup failure stays500. Set no-store on auth/me responses including errors; session failure middleware must also avoid cacheable identity responses. Keep existing user-scoped cart SQL unchanged.
- [ ] Re-run new tests plus `test/api.test.js`, `test/reliability-api.test.js`, `test/postgresql-errors.test.js` inside the isolated cluster. At this task the legacy logout route is removed in Task6 next; all existing non-logout assertions must pass. Commit: `fix: regenerate and save authentication sessions before success`.

## Task 6: POST-only logout and baseline contract migration

**Files:** modify `routes/auth.js`, `controllers/authController.js`, `sessions/policy.js`, `public/js/logout.js`, `test/api.test.js`, `test/reliability-ui.test.js`; create `test/session-logout.test.js`; integrate the early method rule in `server.js`.

**Interfaces:** consumes invalidateSession/clearSessionCookies/config; produces logoutPolicy. POST receives JSON `{}`; require application/json (allow charset), return415 `{error:'JSON body required'}` for unsupported content type,403 `{error:'Forbidden'}` for Origin/Fetch Metadata rejection. Malformed JSON retains the existing parser400. Production POST requires exact normalized PUBLIC_ORIGIN, rejects missing/null/foreign Origin and cross-site Fetch Metadata. Development originless native clients work; supplied Origin must match configured development origin. No permissive CORS.

- [ ] Adapt exactly the two baseline logout invocations in `test/api.test.js` (session invalidation; cart survives logout/login) to `{method:'POST',body:{}}`. Retain all following /me/cart401 and cart-equality assertions. Use a separately retained pre-logout raw cookie to prove server invalidation after clearCookie changes the helper jar. Retain all existing UI error assertions; add method/header/body assertions to the frontend fetch tests and a successful-click test.
- [ ] Add explicit no-mutation GET/HEAD tests for both `/api/auth/logout` and its trailing slash, anonymous and authenticated:

```js
assert.equal(get.status, 405)
assert.equal(get.headers.get('allow'), 'POST')
assert.deepEqual(get.body, { error: 'Method not allowed' })
assert.equal(head.status, 405)
assert.equal(head.body, null)
assert.equal(get.setCookies.length, 0)
assert.deepEqual((await retainedCookieMe()).body, { isLoggedIn: true, name })
```

  Also snapshot the session row before/after GET/HEAD and ensure both requests leave it unchanged. Verify405 even when a supplied cookie's store read would fail: reject unsupported methods before session middleware. Production transport rejection still takes priority on insecure ingress.
- [ ] Add POST destroy success/failure/idempotence tests, expiry-clearing attributes, multiple production cookie deletion including legacy connect.sid, invalid Origin/null/missing production Origin, form submission/content-type, cross-site Fetch Metadata and spoofed Host. POST rejection must preserve identity/rows; successful POST raw replay must fail. Destroy callback failure returns existing500, clears browser cookie, emits no false server-revocation claim.
- [ ] Run targeted tests and observe RED. Implement the early GET/HEAD405 rule with Allow: POST, exact paths and no body for HEAD; routes/auth.js exposes only POST logout with policy. No GET alias, redirect, deprecation window or automatic HEAD fallback. Both unsupported methods bypass session middleware without mutating data. Frontend fetch sends method POST, Content-Type application/json, body JSON.stringify({}); preserve duplicate-click protection, redirect only on ok and retry message on failure.
- [ ] Run `bash scripts/start-test-postgres.sh node --test test/api.test.js test/reliability-ui.test.js test/session-logout.test.js`. Expected green, all original security assertions retained with the approved method change plus stronger replay checks. Commit: `fix: replace GET logout with protected POST contract`.

## Task 7: Browser-enforced production-cookie verification

**Files:** create `test/session-browser.test.js`; extend `test-support/tls.js`; modify `package.json`, `package-lock.json`, `.github/workflows/api-tests.yml`.

**Interfaces:** consumes verified-TLS DB fixture, production app child, TLS proxy and actual repository public assets. Produces mandatory real Chromium coverage using the regular `node --test` runner; no separate job whose failure can be ignored.

- [ ] Resolve `npm view playwright version` at execution time, review that exact published package metadata/artifact and lockfile impact, then install that reviewed numeric version using `npm install --ignore-scripts --save-dev --save-exact` with the exact `playwright@` version argument recorded by that review (never an unreviewed latest/range). Record the selected version in the lockfile/change record. Install Chromium explicitly using `npx --no-install playwright install chromium` locally/macOS, and `npx --no-install playwright install --with-deps chromium` on Linux. These are future steps; no package/browser is installed during planning. Audit the full graph. Do not introduce browser test skips based on a missing binary; fail with actionable setup instructions.
- [ ] Write browser tests asserting registration/login through local HTTPS yields __Host-vinyl.sid Secure/HttpOnly/Lax/path=/, no Domain, expiry about8h, no profile/password in cookie and no visibility in document.cookie. The browser context may ignore certificate errors only for this disposable proxy CA; PostgreSQL verify-full remains mandatory. Record that certificate bypass limits browser PKI evidence, not cookie attribute enforcement.
- [ ] Exercise actual logout UI: POST JSON emitted once for a double click, browser cookie removed, retained raw SID rejected, GET/HEAD navigation cannot log out. In a separate HTTP context assert production cookie is not sent over HTTP and production HTTP login cannot report success. Use localhost consistently rather than changing hostnames to simulate transport. Add development HTTP cookie coverage separately; do not infer browser semantics from native fetch.
- [ ] Run `bash scripts/start-test-postgres.sh node --test test/session-browser.test.js`. Expected RED for missing behaviors/fixtures until the browser cases are implemented; fix only fixture/test integration or session scope issues, then expect all pass with Chromium closed before process/schema teardown.
- [ ] Add explicit browser installation steps to both existing CI jobs before npm test; keep job names/PG17 provisioning/Node24/audit unchanged. Run the same browser tests on Linux and macOS; no continue-on-error, skip or narrowed default npm-test discovery. Commit: `test: verify production session cookies in Chromium`.

## Task 8: Operational docs, full regression, dependency/security review and handoff

**Files:** modify `README.md`, `.env.example`; create `docs/secure-sessions.md`; update verification records in the spec and this plan only after actual execution evidence exists. No publication is included in this task.

**Interfaces:** consumes completed Tasks1–7; produces documented setup, migration/rotation procedures, verified local/CI evidence and a reviewable implementation branch.

- [ ] Document the breaking contract: POST logout with JSON, GET/HEAD405 and Allow: POST, frontend migration and retained failure JSON; no legacy alias. Record the two baseline API call adaptations and retained invalidation/cart assertions plus added coverage. Retain all88 baseline behavioral cases; total test count will grow and is not a fixed target number.
- [ ] Replace README's fallback-secret/encryption description with explicit signing-key generation; remove the obsolete instruction to keep existing session configuration. Document current/previous-key rollout phases,8h+5min old-key retention after the last old signer, emergency revocation/forced login, no secret output/logging, local HTTP origin overrides, environment-only/.env precedence and Azure application settings without Azure commands/provisioning.
- [ ] Add setup sequence `npm run db:init` then `npm run db:init:sessions` before start; table privileges, no runtime DDL, fixed expiry versus pruning, shared-pool budget5 per worker, generic diagnostics, bounded shutdown, partial-registration failure/account recovery and copied-cookie destroy-failure limits. Explicitly say synthetic proxy tests do not verify Azure peers/header cleanup; production deployment remains gated on topology evidence. No claim of all-CSRF protection, global revocation or interruption of already-authorized requests.
- [ ] Run `npm ci --ignore-scripts`, `npm audit --audit-level=high`, and `bash scripts/start-test-postgres.sh npm test` with Chromium available. Expected all tests pass,0 skipped/cancelled; original88 behavioral cases still present. Inspect lockfile duplication, lifecycle scripts, exact versions and pg compatibility. Any security-gate failure is investigated, never disabled. Run git diff whitespace checks and inspect scoped diff for secrets/unrelated files.
- [ ] After a separately authorized push/PR, require fresh Linux `test`, macOS `test-macos` and existing SonarCloud check results for the exact head before claiming CI success. Until then report local evidence only. This plan does not authorize a push or PR. Keep rulesets unchanged; no merge.
- [ ] Perform the required final code review using `superpowers:requesting-code-review` and resolve actionable findings, rerunning tests only as changes/failures justify. If the chosen execution workflow uses independent reviewers, follow its review gates. Commit the operational docs and actual verification record: `docs: document secure persistent sessions and logout migration`.
- [ ] Present changed behavior, tested environments, remaining Azure evidence gap, baseline adaptation ledger and any residual risks. Stop for the human's next instruction; no deployment/publication/merge is implicit.

## Coverage and planning self-review

| Approved specification area | Owning tasks |
| --- | --- |
| Current architecture/alternatives/constraints |0; approved spec remains attached |
| Secrets/cookies/rotation |1,5,7,8 |
| Persistent table/schema/init safety |2,3 |
| Azure assumptions/forwarding spoof defense |1,4,7,8 |
| Authentication fixation/save/error handling |5 |
| POST logout/GET+HEAD405/API consumers |6,7,8 |
| Expiry/pruning/pool lifecycle |2,3,4,5 |
| Tests/user isolation/restarts/failures/Linux+macOS |2–8 |
| Risks/deployment decisions/approval boundaries |0,8 and spec section12 |

Self-review completed during planning: logout deprecation contradictions removed from the spec; baseline exceptions limited to the approved migration; existing CLI weak-key setup identified; production test DB TLS and cookie enforcement have explicit owners; no unsafe test bypass; names/shapes consumed by later tasks match the interface map. Task commands and assertions describe future checks, not tests already run. Dependency version/artifact review and Azure deployment facts remain explicit evidence gates, not placeholders or assumed results.

**Approval gate:** Read this plan together with the amended specification. Explicitly approve the plan and choose native sequential or subagent-driven execution before any implementation action. No implementation has started.
