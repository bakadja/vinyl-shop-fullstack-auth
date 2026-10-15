# Secure and persistent Express sessions

Date: 2026-10-15. Repository: `bakadja/vinyl-shop-fullstack-auth`.
Status: approved for implementation planning on 2026-10-15, with the human-approved POST-only logout amendment recorded below. Implementation still requires explicit approval of the implementation plan.

## 1. Purpose, scope and evidence

Provide persistent, secure authentication sessions for Node.js 24, Express 4 and PostgreSQL 17, with a future Azure App Service / Azure Database for PostgreSQL deployment. Reuse PostgreSQL; introduce no Redis or Azure resources. Preserve existing API payloads, application data, test assertions except the explicitly approved logout contract adaptations, Linux/macOS integration testing and security checks. The specification and implementation plan are the only authorized deliverables at this stage; no dependency installation, application changes, new branch, PR, merge or deployment is authorized.

The brainstorming brief is supplied by the request: inspect the current flows, compare three alternatives, propose the architecture and stop for explicit approval before planning. The human approved this architecture for planning and selected immediate POST-only logout in PR #8. Open deployment facts are identified rather than guessed.

Inspection baseline: local HEAD `ff4340c2a70a61ef571bea27dffe69a0e8c3de7d`, existing branch `feat/postgresql-migration`. The working repository is the `vinyl-shop-fullstack-auth` child directory of the workspace. This is not a freshly checked-out `main`. The request reports PRs #1–#7 merged and three required checks; remote merge state, rulesets and live Sonar status were not independently verified. No branch switching or ruleset changes are needed for this document.

Inspected: `server.js`; authentication/current-user controllers and routes; `middleware/requireAuth.js`; cart routes/controller; `db/config.js`, `db/db.js`, `db/init.sql`; `scripts/init-db.js`, `scripts/start-test-postgres.sh`; `test-support/http.js`, `test-support/postgresql.js`, provisioning SQL; all authentication, database, PostgreSQL isolation/regression/configuration/error tests; relevant UI tests and `public/js/logout.js`; package manifest/lockfile, `.env.example`, and `.github/workflows/api-tests.yml`.

The lockfile has Express 4.22.3, express-session 1.18.2 and pg 8.23.1. This design targets those interfaces, not new options appearing in newer middleware documentation. Local Node is v24.21.0. Verification results are recorded at the end.

## 2. Current architecture and contracts

### Authentication and session lifecycle

`server.js` installs JSON parsing, then express-session, then static files and API routers. No explicit store means MemoryStore. `resave:false`, `saveUninitialized:false`, HttpOnly and SameSite=Lax are enabled. Secure is always false. There is no configured trust proxy, maxAge or expiry. The default cookie is host-only `connect.sid`, path `/`, with no persistent expiration. A browser may restore session cookies; closing a browser is not a server-side expiration policy.

Registration validates and trims inputs, checks duplicates, hashes the password with bcrypt, inserts a user and writes the returned ID into `req.session.userId`. Login retrieves the user, checks bcrypt and writes that ID into the current session. Both immediately send success; neither calls regenerate or explicitly awaits save. Middleware ordinarily saves changed sessions at response completion, but controller success is not conditional on a successful store callback. Invalid credentials do not assign a user ID.

Logout is `GET /api/auth/logout` (also accepted with a trailing slash). It waits for `session.destroy` before returning success or a sanitized failure. It does not clear the browser cookie. `/me` checks userId, then queries the user's name; `requireAuth` checks only userId. An already deleted user causes `/me` to fail while cart authorization can still see a stale identity. There is no user-disable or global session-revocation mechanism.

Authentication survives subsequent requests only with a valid signed cookie and the matching process's MemoryStore row. It does not survive process restart or work consistently across independent workers. Carts and users persist independently in PostgreSQL; logout does not delete them. The cookie contains an opaque signed session identifier, not passwords or the user's profile. Signing does not encrypt server-side session contents or protect a stolen cookie from replay.

### HTTP contracts to preserve or explicitly migrate

| Endpoint / condition | Existing contract |
| --- | --- |
| POST `/api/auth/register` | 201 `{message:'User registered'}` and authenticated session |
| Invalid registration / duplicate | 400, existing error strings retained |
| Registration failure | 500 `{error:'Registration failed. Please try again.'}` |
| POST `/api/auth/login` | 200 `{message:'Logged in'}` and authenticated session |
| Missing login fields / wrong credentials | 400 / 401 with existing error strings |
| Login failure | 500 `{error:'Login failed. Please try again.'}` |
| GET `/api/auth/logout` | 200 `{message:'Logged out'}`; destroy failure 500 `{error:'Logout failed. Please try again.'}` |
| GET `/api/auth/me` | 200 `{isLoggedIn:false}` or `{isLoggedIn:true,name}` |
| Anonymous cart access | 401 `{error:'Unauthorized'}` |
| Middleware / unexpected API failure | Sanitized 500 `{error:'Internal server error'}` |
| Invalid JSON / excessive body | Existing sanitized 400 / 413 |

Do not change catalogue/cart response shapes, validation or user-scoped SQL. Existing tests explicitly assert `connect.sid` and no Set-Cookie on an ordinary authenticated `/me` response. They currently call GET logout and test that the server rejects a retained old cookie. Approved PR #8 change: migrate those calls to POST with JSON, retain their invalidation/cart-persistence assertions, and add GET/HEAD 405 assertions proving that neither method destroys a live session. The table above describes the inspected baseline, not the amended contract.

### Database lifecycle and isolation

`getDatabase()` lazily constructs one pg pool behind query/transaction/close methods. The wrapper does not expose a pool suitable for passing directly to connect-pg-simple. Pool configuration uses max=5, connection timeout=5s, idle timeout=10s, validated `DATABASE_SCHEMA` through search_path, and verified TLS except explicit loopback non-production disable mode. URL options cannot weaken TLS. The server listens before this lazy database is first queried. SIGINT/SIGTERM stops accepting HTTP, waits for server close, then closes the database; there is no bounded drain deadline.

The explicit initializer runs transactional, advisory-locked DDL and compatibility validation before catalogue seeding and sequence alignment. It never seeds accounts/carts. Runtime startup does not run it.

Fixtures require an explicit loopback disposable `vinyl_shop_test` database and restricted role, verify an administrator-owned marker and privileges, and create a random schema per fixture. Child environments are allowlisted rather than inherited; each HTTP child gets port 0 and a random secret. Teardown stops the HTTP child before closing fixture connections and invoking the atomic name/OID/owner-checked schema deletion helper. Tests cover renamed/recreated namespaces, hostile targets and initialization races. Preserve these guards without introducing a fallback to the application's database.

## 3. Security risks

| Finding | Consequence / design response |
| --- | --- |
| Public hardcoded secret fallback | Predictable cookie signing configuration; require generated explicit keys |
| MemoryStore | Restart loss, worker inconsistency and unsuitable production resource behavior |
| No regenerate after authentication | An existing valid SID crosses the authentication boundary |
| No awaited save | A persistent-store failure can follow a nominal success response |
| Secure=false and no production guard | Session bearer cookie can travel over HTTP |
| No explicit lifetime | Authentication retention is not deliberately bounded |
| State-changing GET logout | Cross-site top-level navigation can log out a user with Lax cookies |
| Cookie not cleared | Browser retains a dead identifier; destruction alone does not remove it |
| Future unqualified store setup | Wrong schema, bypassed TLS config or hidden additional pools |
| Raw dependency error logging | Store/pruning errors could expose connection or session details |
| Proxy trust chosen without topology evidence | Forwarded protocol can be spoofed; Secure cookies alone do not reject HTTP requests |

Express explicitly identifies MemoryStore as unsuitable for production in its [session documentation](https://expressjs.com/en/resources/middleware/session/). Do not equate a strong signing secret with protection against cookie theft, XSS or all CSRF.

## 4. Alternatives and recommendation

| Dimension | connect-pg-simple | Minimal custom PostgreSQL Store | MemoryStore |
| --- | --- | --- | --- |
| Security | Existing store contract; still requires secure app configuration | Team owns callback correctness, SQL, expiry and failure races | No new dependency, but no durable/shared state |
| Maintenance | Smaller integration surface; external release/advisory monitoring | Permanent security-sensitive code and tests | Simple development setup, unsuitable production behavior |
| Node 24 / Express 4 | Candidate metadata admits Node 24; Express 4/session API used upstream | Uses current dependencies, full compatibility must be demonstrated | Already used locally |
| PostgreSQL 17 | Ordinary pg queries; validate on our real PG17 suite | Team owns DDL and PG17 compatibility | Not applicable |
| Pooling | Explicit caller-owned pool supported | Reuse wrapper or pool deliberately | No pool |
| Expiry / cleanup | Built-in expiry filtering and pruning controls | Implement get/set/touch/destroy and cleanup correctly | Process-local only |
| Operations | One extra table and prune workload in existing DB | Same infrastructure plus owned scheduler/diagnostics | Restart/scale loss; affinity cannot fix durability |
| Dependency security | Adds a package and pg dependency resolution to audit | No new runtime package, greater custom-code burden | No added package, does not meet objective |

Recommend connect-pg-simple, conditional on exact package review, lockfile audit and Node24/PG17 regression results at implementation time. A custom Store saves a dependency but takes ownership of expiry boundaries, session callback semantics, SQL safety, cleanup and race behavior for little application benefit. MemoryStore is rejected for the deployed app, and should not remain an automatic fallback on store failure. Use the real PostgreSQL store in development and integration tests too; synthetic stores are only for deterministic failure injection tests.

The upstream [candidate package metadata](https://raw.githubusercontent.com/voxpelli/node-connect-pg-simple/master/package.json) currently identifies 10.0.0, Node `>=22` among supported ranges, pg `^8.12.0`, and Express4/session development dependencies. This is source compatibility evidence, not proof of a published version's security or a Node24/PG17 certification. Before installation in a separately approved implementation, resolve the registry artifact, examine its scripts and dependency graph, pin the reviewed version and commit the lockfile; keep `npm ci --ignore-scripts` and the existing high-severity audit gate. No proposed dependency has been installed or audited here. Release availability and advisories can change.

## 5. Recommended components and data flow

Use small configuration, store-lifecycle and authentication-session boundaries. A pure session configuration function validates environment values before listening. Database ownership remains in `db/db.js`; deliberately expose the existing native pool through a narrow accessor for composition, without replacing query/transaction behavior. A session-store factory receives that pool and the validated schema. It must never infer a second connection from DATABASE_URL or library defaults.

Flow: validate config -> open existing pool -> verify session-table compatibility/readiness without DDL -> construct Store/middleware -> listen. On any startup failure, close constructed resources, emit a generic diagnostic and exit nonzero without a listening socket. Body parsing and production transport guards precede the session middleware; session middleware precedes auth/authorization routes. Mark authentication/current-user responses `Cache-Control: no-store`; do not let intermediary caches store identity responses or Set-Cookie.

Keep `saveUninitialized:false`, `resave:false`, `rolling:false`. Approved lifetime is a fixed eight hours after successful authentication, with no rolling renewal and `disableTouch:true`. Store only userId, authenticatedAt and middleware cookie metadata. An application expiry guard checks authenticatedAt before `/me` and protected routes: missing, malformed or past-deadline authenticated sessions fail closed. Ordinary requests never mutate session contents. A later deliberate authenticated session write must cap cookie/store expiry at authenticatedAt+8h; it must not silently extend the deadline. This avoids depending on browser expiry or store cleanup for authorization.

Eight hours is the approved product/security policy, not a measured operational result. An idle timeout would require a separate design and aligned browser/store touch policy. Retain fixed behavior in development/tests, with injectable clocks or isolated test-only lifetime parameters for expiry cases, never a client-controlled lifetime.

## 6. PostgreSQL store and lifecycle

Create `user_sessions` in the exact validated `DATABASE_SCHEMA`, explicitly passing schemaName and tableName separately. Do not introduce a second schema variable or ever hardcode public in fixtures. Proposed table columns are sid varchar primary key, sess json not null, and expire timestamp(6) without time zone not null, with a B-tree index on expire. Keep the package-compatible shape, set database connections to UTC consistently, and test expiry under non-UTC client/server timezone conditions. No foreign key to users, no cascading effect on users/carts, and no profile, password/hash, credentials or tokens in session JSON.

The upstream [table definition](https://raw.githubusercontent.com/voxpelli/node-connect-pg-simple/master/table.sql) is a shape reference only: its legacy `WITH (OIDS=FALSE)` must not be copied into PostgreSQL17 DDL. Use project-owned PG17-compatible migration SQL.

Add a separate explicit session initializer (and CLI), leaving the base catalogue initializer's existing three-table contract intact. HTTP fixtures call base initialization and then session initialization in their own random schema. A bare base-initializer test must still see exactly products/users/cart_items. The session initializer uses the same database abstraction and transaction-scoped advisory lock; creates only the session table/index; validates existing column types, nullability, primary key and expiry index; rejects incompatible preexisting relations atomically. Re-running it must preserve every existing application row and live session. It does not create arbitrary schemas, reset sequences or seed data. Deployment runs explicit initializers before starting workers; runtime `createTableIfMissing:false` forbids automatic DDL. Runtime privileges need session-table DML and schema usage, not schema creation; migration credentials can remain separate in a future deployment.

The [store README](https://github.com/voxpelli/node-connect-pg-simple) documents explicit pooling, ttl, schema/table options and randomized periodic pruning. Configure ttl=28,800 seconds as a fallback, disableTouch=true, pruning interval=900 seconds with randomization enabled, and a sanitized errorLog function. Expiration of authenticated sessions follows the eight-hour deadline, not the pruning interval. All session data/SIDs are parameters; identifier selection is validated and quoted. Cleanup deletes only expired user_sessions rows. It never runs TRUNCATE, deletes accounts/carts, drops schemas or invokes fixture cleanup in runtime.

The inspected [store source](https://raw.githubusercontent.com/voxpelli/node-connect-pg-simple/master/index.js) filters expired rows on reads, upserts sessions, supports disabling touch, and tracks whether it owns the supplied pool. Pruning is process-driven, so stopped workers retain expired rows until activity resumes; these rows must still be unusable. For this application's expected initial scale, randomized per-worker cleanup is acceptable. Monitor table growth and prune failures; larger-scale external cleanup scheduling is a later operational decision, not new infrastructure now.

Resource ownership: stop accepting HTTP, drain in-flight requests, call store.close to stop its timer, wait for tracked prune operations to finish, then closeDatabase exactly once. The source's close method does not itself guarantee every already-running prune query has finished: the lifecycle adapter must track explicit/automatic pruning completion rather than treating timer cancellation as a full drain. Use a bounded shutdown deadline (proposed 10s), sanitized failure diagnostics and nonzero exit on failure. SIGINT/SIGTERM share one idempotent path. Never close the caller-owned pool from two owners. At max=5 per worker, pool capacity is shared between app and sessions; size against worker count and database limits before scaling, not by blindly adding another five connections per store.

## 7. Secrets and cookies

### Explicit environment configuration

Retain `SPIRAL_SESSION_SECRET` as the current-key variable. Require a canonical 64-character hex encoding of 32 cryptographically random bytes in every environment. Reject missing/empty, malformed, known example values and visibly degenerate repeated values. Format checks cannot prove entropy: the documented generator must use `crypto.randomBytes(32).toString('hex')`, and operators must not handcraft keys. This is stricter than the current arbitrary string and is an intentional configuration migration.

No default, automatic startup key or CI bypass. Validate before opening a listener; errors identify only the configuration category, never input values. `.env.example` describes generation instead of containing a usable key; local optional env-file loading stays supported. Existing fixtures change their generated secret from randomUUID to randomBytes(32) without changing test assertions. CI children continue receiving explicit synthetic keys. Tests of rotation/restarts retain a generated key across children in that fixture only.

Support optional `SPIRAL_SESSION_PREVIOUS_SECRETS` as a JSON array of at most two distinct keys satisfying the same rules. Reject malformed arrays, duplicates and invalid keys. Pass `[current,...previous]` to middleware; sign with current, verify against all. All workers/slots must have a compatible verification set. Rotate by first distributing the future key as an accepted verification key while the old key still signs, then switch signing to the new key everywhere, retaining the old key for eight hours after the last worker stopped signing with it plus clock/deployment margin (proposed five minutes). Fixed sessions need not be silently renewed. Remove old keys afterward. On compromise, remove the key immediately and accept forced reauthentication; switching only the signing key does not revoke its verification ability.

Use Azure application settings as environment input through the same parser; do not add Azure SDK calls. Keep settings out of source, build output, logs and HTTP responses. A later operator may use managed secret references, outside this task. Shared PostgreSQL and stable keys are both necessary for restart/worker persistence.

The pinned middleware's [1.18.2 README](https://raw.githubusercontent.com/expressjs/session/v1.18.2/README.md) describes key arrays, 32 bytes of entropy, regeneration and explicit save callbacks. This design intentionally awaits save before authentication success.

### Cookie policy

| Setting | Development/test over HTTP | Production |
| --- | --- | --- |
| name | `connect.sid` to retain current assertions | `__Host-vinyl.sid` |
| Secure | false | true, mandatory |
| HttpOnly | true | true |
| SameSite | Lax | Lax |
| Path / Domain | `/`, no Domain | `/`, no Domain |
| maxAge | eight hours | eight hours |
| rolling | false | false |

The production prefix requires Secure, path `/` and no Domain. Separate names prevent accidental local/production cookie collisions; same-host development apps should use separate hostnames if they share `connect.sid`. SameSite=Lax suits the existing same-origin frontend; do not add credentialed cross-origin access or SameSite=None. A cross-origin frontend would require another review.

Browsers receive only the signed SID; userId and authenticatedAt remain in PostgreSQL. Authentication and logout responses must not serialize session objects. In production an HTTP request is rejected before database/auth mutation or session creation; setting Secure=true alone can otherwise suppress Set-Cookie while a handler reports success. Local HTTP remains supported with an explicit key, PostgreSQL config, and no proxy trust. Spoofed X-Forwarded-Proto must not change local security decisions.

## 8. Azure reverse-proxy boundary

Microsoft's [Node.js App Service guidance](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs) describes platform TLS termination, forwarded protocol, and application settings exposed to Node. It is not evidence of this future site's exact socket peers, header sanitization or ingress paths.

Propose explicit modes: direct (development/test only; trust proxy=false) and verified-proxy (required production mode). `NODE_ENV` must be a recognized development/test/production value; unknown values fail configuration validation. Production requires an HTTPS `PUBLIC_ORIGIN` without credentials/path/query/fragment, verified database TLS, the production cookie policy, and an explicit nonempty `TRUSTED_PROXY_CIDRS` list. Reject wildcard/all-address networks and blanket private-network trust. Compile the list once; trust only configured immediate socket peers. Leave express-session's proxy override unset so it uses Express's decision; never set session proxy=true.

For production requests, first require the socket peer to be in the verified list, then require exactly one normalized X-Forwarded-Proto value of `https` and req.secure=true. Reject missing, repeated, comma-separated, http or unexpected protocol values with sanitized 400 `{error:'HTTPS required'}`, before JSON parsing/session/auth side effects. Do not redirect using untrusted Host/forwarded Host. PUBLIC_ORIGIN is operator-supplied, never derived from those headers. Malformed/untrusted requests receive no session cookie. Production config must reject direct mode, empty/invalid proxy ranges and any requested insecure cookie override.

This is stricter than blindly using trust proxy=1: a hop count does not authenticate a peer. Express's [proxy guide](https://expressjs.com/en/guide/behind-proxies/) warns that trust must match ingress topology and sanitized forwarding headers. Even an IP allowlist cannot repair a trusted proxy that preserves attacker-supplied protocol headers.

Before any future production approval, an operator must establish: the actual App Service hosting model; stable, narrowly scoped immediate proxy identities; no bypass path to the Node listener; overwriting of client X-Forwarded-Proto/Host/For at the trusted edge; HTTPS-only public ingress; and the behavior with optional Front Door/Application Gateway/custom containers. Do not invent Azure CIDRs or accept all private addresses to make it work. If the selected App Service model cannot supply a reliable boundary, this mode remains blocked until an alternative authenticated/sanitizing ingress design is reviewed. Any extra proxy changes the topology and requires revalidation. Synthetic proxy tests prove application behavior, not Azure's platform behavior.

## 9. Authentication transitions and failures

After valid credentials (or a committed user insert), await session.regenerate; only after its callback succeeds assign userId/authenticatedAt to the new session, then await session.save. Send the existing 201/200 payload only after save succeeds. Never copy an old session wholesale. Failed credentials must not regenerate or overwrite an already valid identity; preserve existing validation/error contracts.

On regenerate/destroy-old failure, return the existing sanitized registration/login failure, clear the browser cookie and do not assign the new identity. On save failure, clear the cookie, detach/destroy the new session so response completion cannot automatically retry saving it, attempt deletion of any partially committed new SID, log only a generic failure and return the existing 500. A cleanup failure is observable but must never become success. A database write can commit before a connection failure is reported: cleanup is best effort and cannot be advertised as transactional certainty.

Registration inserts the user before saving the session; the Store uses independent pooled operations, so do not hold a user-insert transaction open waiting for session writes. If session creation fails after insertion, the account remains, the response is 500 and the caller can login/recover rather than blindly register again. Do not delete the user/cart as compensation. Document this partial-success limitation; a fully atomic account+session transaction would require a different store integration.

For `/me`, a missing user becomes an anonymous session after invalidation instead of dereferencing user.name. Database failure remains sanitized 500. Normal user isolation continues to rely on server-side userId and existing user-scoped cart SQL. Malformed session payloads are rejected, not trusted as request-provided identity.

Session regeneration invalidates the old SID after successful deletion; arbitrary invalid cookies must never become authenticated. Concurrent requests already authorized before logout or regeneration can finish. Keep sessions read-only outside authentication so requests cannot resave an old identity after logout; disabled touch must not recreate rows. Strong cancellation of already-authorized requests, global logout and account-disable revocation are not supplied by this Store design.

## 10. Logout migration and CSRF

Approved amendment (2026-10-15): replace GET logout with POST `/api/auth/logout` during PR #8. POST retains the existing 200 `{message:'Logged out'}` and 500 `{error:'Logout failed. Please try again.'}` responses. GET and HEAD return 405 with `Allow: POST`; GET returns sanitized `{error:'Method not allowed'}`, and HEAD has no response body. Neither rejected method destroys or clears an authenticated session. Apply this behavior to the trailing-slash path too; explicitly handle HEAD rather than relying on Express's automatic GET fallback. There is no compatibility alias or deferred removal release.

Document this breaking API contract change in README and session change documentation. Update the frontend logout fetch to POST with JSON. Adapt the affected baseline tests to the new method while retaining every session invalidation, cart preservation and UI failure assertion; add regression coverage for safe GET/HEAD rejection. This is the only approved baseline contract exception and must not reduce security coverage.

POST alone is not CSRF protection. Require JSON content type for the new route and validate any supplied Origin against an explicit configured origin (production PUBLIC_ORIGIN); reject mismatches or `null` with sanitized 403. Reject cross-site Fetch Metadata. In production require a matching Origin for POST; clients without one need an explicitly reviewed authentication/CSRF policy, not an automatic exception. The browser fetch uses a JSON body/content type. In development/test the originless native test client remains supported; add production tests supplying Origin. Do not infer the allowed origin from Host headers or enable permissive CORS.

Wait for successful session destruction, then clear the active cookie with matching path/domain/Secure/HttpOnly/SameSite attributes and an expired value, omitting maxAge/expires options when calling clearCookie so Express supplies deletion expiry. Clear the legacy host-only connect.sid on production migration too; do not accept it as a production login credential. Successful logout without a live session is idempotent. On destroy failure return the existing 500 and clear the local cookie, but state that a stolen/copied cookie may remain valid until expiry or successful retry. Never claim server revocation merely because a browser cookie was removed. Test raw replay independently of the helper's cookie jar.

## 11. Regression and verification strategy

Preserve the behavioral coverage of all 88 existing tests and their assertions, except for the approved GET-to-POST logout call/contract adaptations. Retain all invalidation and cart-persistence assertions, and add GET/HEAD 405 tests. Add tests; do not skip security cases or weaken unrelated exact assertions. Changes to fixture setup (strong keys, explicit session initialization, restart/raw-cookie capabilities) are necessary, while keeping target/role/marker and schema-identity guards intact. Keep the existing Linux PG17 service, macOS private PG17 cluster and Node24 runs, high-severity npm audit and existing required checks. Do not disable checks or change rulesets.

| Area | Required evidence in the future implementation |
| --- | --- |
| Configuration | Child exits nonzero before listening for missing/invalid/current/previous keys, unknown environment, unsafe production mode, HTTP origin, invalid proxy list or weak DB TLS; no secret/log leakage |
| Development cookies | Explicit connect.sid, HttpOnly/Lax, no Secure, correct expiry; anonymous/invalid login creates no stored identity; ordinary /me still has cookie:null |
| Production cookies | Real browser through a local TLS-terminating test proxy; __Host-vinyl.sid Secure/HttpOnly/Lax/path=/, no Domain; HTTP cannot authenticate; cookie absent from document.cookie |
| Proxy spoofing | Actual trusted/untrusted socket peers, not just fake headers; trusted HTTPS works; untrusted peer plus https header, missing/http/duplicate/list values fail before writes; app guards and proxy overwriting tested separately |
| Fixation | A real existing authenticated SID before login/register, compare new SID and replay old raw cookie; also controlled anonymous stored-session case; old identity never copied |
| Save/regenerate failure | Deterministic callback injection for regenerate/destroy/set including commit-then-error; no 2xx, no authenticated cookie, sanitized errors, no auto-resave, partial account retained as specified |
| Persistence | Register/login, retain raw cookie and generated secret/schema, stop child fully, restart against same DB/schema/key, replay cookie and read same user/cart; optionally two concurrent workers |
| Key rotation | Old cookie works with staged key sets and after signing switch; new cookie signed by current; removed key rejected; restart with wrong key anonymous |
| Logout | POST success/failure contracts; GET/HEAD return405 with Allow: POST and preserve the live session (HEAD has no body); matching Origin succeeds, cross-site/null fails; cookie deletion attributes; replay saved pre-logout SID gets anonymous /me and cart401; failure500 does not claim revocation; HEAD considered |
| Expiration | Cookie deadline, store row and authenticatedAt agree; raw replay of expired row fails before pruning; no touch/rolling extension after reads; boundary and non-UTC tests; no hours-long sleeps |
| Store outage | Real PostgreSQL table/permission or connection failure plus deterministic callback tests; middleware get failure returns sanitized500, auth save never succeeds, pruning logs sanitized, recovery keeps process usable; no MemoryStore fallback |
| Isolation | Two users, old/new SIDs and cross-worker replay preserve scoped carts; deleted-user /me handled safely; malformed stored payload rejected |
| Initialization / cleanup | Fresh/repeated/concurrent session init; reject incompatible tables/indexes without partial DDL; expiry pruning preserves live rows and exact products/users/carts snapshots; another schema's sessions survive |
| Shutdown | SIGINT/SIGTERM and repeated signals close timer/prune activity and the one pool, child exits within deadline; fixture stops children before verified schema cleanup |

Use real PG17 for persistence, initialization, expiry and cleanup. Controlled clocks or backdating rows/session timestamps are preferable to timing-dependent sleeps. Separate native raw-cookie replay tests from browser cookie enforcement: the existing test client stores only the first Set-Cookie pair and does not implement Secure, SameSite, expiry or complete multi-cookie deletion. Extend it additively or add a dedicated harness; do not mistake its behavior for browser evidence. A development fixture startup in a temporary directory also does not exercise actual static frontend serving; use the repository public assets for browser flows.

## 12. Risks, limits and open decisions

The recommended store adds database dependency to authenticated request handling; a DB outage fails closed with errors, not anonymous success or an in-memory fallback. A five-connection pool may contend under load; scale/load behavior is unmeasured. Expired rows/backups still contain identifiers until retention cleanup; restrict database access and establish deployment retention rules. Session JSON is not encrypted by this proposal. Production database TLS remains verified.

No general CSRF framework, rate limiting, MFA, password policy redesign, Sentry, payments or checkout is introduced. Lax cookies and JSON requests reduce some cross-site risks but are not universal CSRF protection, particularly with untrusted same-site subdomains. Production hardening beyond this session subsystem may require a separate review. Partial registration failure and concurrent in-flight requests have the specific limits described above. GET/HEAD logout no longer mutate authentication state under the approved contract.

Approved decisions (2026-10-15): connect-pg-simple with the existing caller-owned pool; fixed eight-hour sessions; cryptographically generated explicit secrets and controlled rotation; secure production cookies; regenerate and explicitly save after authentication; strict PostgreSQL isolation; immediate POST-only logout in PR #8, rejecting GET and HEAD with405. The existing detailed policies in this specification are the planning baseline, subject to the amended logout contract.

Remaining deployment evidence and review gates:

1. Recheck the selected dependency artifact/advisories and prove integration on Node24/PG17 during implementation.
2. Confirm the future Azure hosting/ingress model and narrowly scoped proxy peers/header-overwrite guarantees. No usable CIDRs are asserted here; Azure proxy topology remains unverified until deployment evidence exists.
3. Confirm operational runtime/migration credential separation and connection budget when deployment is designed.
4. Obtain explicit human approval of the detailed implementation plan and an execution method before implementation. Architectural approval authorizes planning only, not application edits, dependency installation, branch creation or publication.

## 13. Specification verification record

Source inspection and live primary-documentation review completed on 2026-10-15. This document distinguishes inspected local behavior, proposed policy and unverified Azure/remote state. All links above are evidence sources; upstream master URLs are mutable and must be rechecked against the selected release before implementation.

Baseline verification: `bash scripts/start-test-postgres.sh npm test`, using existing dependencies, local Node v24.21.0 and a fresh private PostgreSQL17 cluster, completed with 88 passed, zero failures, zero skipped/cancelled tests (reported test duration approximately 9.9s). The restricted-environment attempt exited before test output; rerunning with permission for the helper's local cluster succeeded. This is a local macOS baseline result, not a fresh Linux CI or Azure result. The new architecture itself is not implemented or tested by this task.

Specification self-review checked all requested areas, explicit migration conflicts, environment boundaries, pool ownership, expiry/cleanup separation and open decisions. No application source, tests, manifests or lockfiles were changed. The preexisting untracked .DS_Store files were left untouched. The specification remains an uncommitted file for human review on the existing branch; no feature branch or PR was created.

Planning amendment record (2026-10-15): the human approved the architecture for planning, replaced staged GET logout deprecation with immediate POST-only logout in PR #8, and explicitly authorized adaptation of affected baseline tests without reducing security coverage. No implementation is authorized by this record.

Execution handoff (2026-10-15): the planning-stage uncommitted/no-branch record above is historical. The approved architecture was implemented in an isolated branch from verified origin/main; the final local suite passed118/118 after the independent review corrections. See [execution and review record](../../secure-sessions-review.md). No publication or Azure deployment is authorized by completion.
