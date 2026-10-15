# Secure persistent sessions (PR #8)

## API migration

Logout now requires `POST /api/auth/logout` with `Content-Type: application/json` and body `{}`. A successful response remains 200 `{ "message": "Logged out" }`; a failed destruction remains 500 `{ "error": "Logout failed. Please try again." }`. GET and HEAD return 405 and `Allow: POST`, including trailing-slash paths, without clearing cookies, querying the session store or changing authentication. GET has `{ "error": "Method not allowed" }`; HEAD has no body. There is no legacy GET compatibility alias. The included frontend sends POST; external clients must migrate too.

POST logout rejects unsupported content types with 415 and foreign/null Origin or cross-site Fetch Metadata with 403. Production also requires Origin exactly equal to PUBLIC_ORIGIN. A same-origin browser fetch supplies Origin; originless non-browser production clients need a separately reviewed CSRF/client policy. Development/test originless native clients remain supported. JSON parsing retains existing 400/413 responses.

## Local setup

Use Node.js 24 and PostgreSQL 17. Keep existing database/TLS settings. Generate a current signing key from 32 random bytes; there is no fallback and a handpicked phrase or UUID is insufficient. The accepted encoding is exactly 64 lowercase hexadecimal characters, excluding repeated patterns. Validation cannot prove entropy; use a cryptographic generator/secret manager.

For an existing local `.env` without SPIRAL_SESSION_SECRET, this example appends a generated value without printing it. Review your existing configuration first; it refuses to replace an existing entry. Do not run it in CI or against a shared file. Protect the file and never commit it.

```js
// Run locally with: node --input-type=module
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, appendFileSync, chmodSync } from 'node:fs'
const filename = '.env'
const content = existsSync(filename) ? readFileSync(filename, 'utf8') : ''
if (/^\s*(?:export\s+)?SPIRAL_SESSION_SECRET\s*=/m.test(content)) throw new Error('Existing key requires deliberate replacement')
appendFileSync(filename, '\nSPIRAL_SESSION_SECRET=' + randomBytes(32).toString('hex') + '\n', { mode: 0o600 })
chmodSync(filename, 0o600)
```

Do not log or paste a key into an issue. If a key already exists but is weak, deliberately replace it locally with a generated value using your secret-management/editor workflow. Existing sessions become invalid if their verification key is removed. This implementation does not modify an existing `.env` file.

Initialize explicitly, then start:

```sh
npm ci --ignore-scripts
npm run db:init
npm run db:init:sessions
npm start
```

The second initializer creates only the session table/index within DATABASE_SCHEMA, transactionally and under the existing per-schema advisory lock. It rejects incompatible schemas and never deletes accounts/carts or reseeds products. It is safe to repeat with live sessions. The base initializer still creates exactly the three application tables. Runtime performs read-only session schema/privilege validation before listening; missing session schema/configuration prevents startup. Runtime never creates the table automatically.

Environment variables override the optional `.env`; environment-only operation is supported. Use an explicit key in every local/CI child. `.env.example` has no usable session key.

| Variable | Policy |
| --- | --- |
| SPIRAL_SESSION_SECRET | Required 64-character lowercase hex encoding of 32 random bytes; signs new cookies |
| SPIRAL_SESSION_PREVIOUS_SECRETS | Optional JSON array of up to 2 distinct previous/future verification keys, same validation; defaults to[] |
| NODE_ENV | development (default), test or production; unknown values rejected |
| DATABASE_SCHEMA | Existing validated schema identifier; defaults public for ordinary app use; tests always use their private schema |
| PUBLIC_ORIGIN | Required canonical HTTPS origin in production; local default http://localhost:8000; explicitly set for127.0.0.1 or another port |
| SESSION_PROXY_MODE | direct in development/test by default; production requires verified-proxy |
| TRUSTED_PROXY_CIDRS | Explicit immediate peer allowlist in verified-proxy mode; IPv4 /24–/32, IPv6 /64–/128 only |

The narrow CIDR prefix policy is deliberate: default routes, named/broad private networks and large explicit ranges fail startup. IPv4-mapped IPv6 peers are normalized by proxy-addr. A permitted range still requires deployment evidence; the prefix restriction alone does not prove that every member is trustworthy. Cookie-name/Secure/HttpOnly/SameSite/Domain and rolling override variables are unsupported and rejected, not security escape hatches.

## Cookie and lifetime policy

Development/test HTTP uses `connect.sid` with HttpOnly, SameSite=Lax and Path=/. Production uses `__Host-vinyl.sid` with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain. Only an opaque signed SID reaches the browser. Signing is not encryption; userId/authenticatedAt/cookie metadata stay in PostgreSQL. Sessions expire eight hours after successful authentication, with no rolling or idle renewal. Reads do not extend the database deadline; the application also enforces authenticatedAt at the exact eight-hour boundary.

Successful login/registration destroys the old SID through regeneration and awaits explicit session saving before reporting success. A session-store failure yields a sanitized error, clears the browser cookie, detaches the session to prevent response-end resaving and attempts deletion of any partially written SID. Registration can commit an account before session saving fails: a 500 may therefore leave an account that can subsequently log in. It never compensates by deleting accounts or carts.

Logout destroys server state before reporting success and clears the browser cookie; production also clears the legacy host-only connect.sid. If destruction fails, the browser cookie is cleared but a copied cookie may remain valid until successful revocation/expiry. Requests already authorized before logout can finish. This feature is not global logout, account-disable revocation, general CSRF protection, rate limiting or MFA.

## Key rotation

1. Generate the next key cryptographically and distribute it as an accepted previous/future verification key while the current key still signs. Maintain compatible verification sets on every worker/slot.
2. Switch SPIRAL_SESSION_SECRET to the new key everywhere, retaining the old key in SPIRAL_SESSION_PREVIOUS_SECRETS.
3. Keep the old verification key for eight hours plus five minutes after the last worker stopped signing with it, then remove it. Fixed sessions are not silently renewed just to rotate a signature.
4. On compromise remove the affected verification key immediately and accept forced reauthentication. Merely switching the signing key does not revoke cookies if the old verification key remains accepted.

Azure application settings can supply these environment variables using the same parser. No Azure SDK/provisioning/deployment is part of PR #8. Secret-store references, slot handling and access controls remain deployment work. Never log the values or put real keys into docs/workflow files.

## Storage, cleanup and shutdown

The caller-owned pg pool is shared by application queries and connect-pg-simple, with the existing maximum of 5 connections per worker. No hidden pool is created and no MemoryStore fallback exists. Budget all workers against the database connection limit before scaling; contention/performance has not been load-tested.

The schema-qualified user_sessions table has sid varchar primary key, sess json and expire timestamp(6) without time zone, plus a B-tree expiry index. Application connections explicitly use UTC. Values/SIDs use parameters; schema identifiers are validated and quoted. Runtime requires schema USAGE and each of SELECT/INSERT/UPDATE/DELETE on this table. Explicit migration credentials require table/index creation privileges; credential separation belongs to deployment configuration.

Expired sessions are rejected on read before pruning. Randomized cleanup runs at a mean interval of 900 seconds while the store is active, deleting only expired session rows. Inactive/stopped workers do not guarantee physical deletion at that interval; expired rows remain unusable. Monitor table growth and sanitized cleanup failures. No cleanup path truncates/deletes users/carts, drops schemas or invokes test cleanup. Backups may retain session data according to their own retention policy; session JSON is not encrypted by this feature.

SIGINT/SIGTERM uses one idempotent shutdown path: stop accepting/drain HTTP, stop pruning/drain store queries, then close the single pool. The total deadline is 10 seconds; failure/timeout exits nonzero with a generic diagnostic. Restart persistence requires the same database/schema and a compatible verification-key set.

## Production proxy limitations

Production refuses direct mode, unverified database TLS and unsafe cookie configuration. Each request must arrive from an explicitly trusted immediate socket peer, contain exactly one X-Forwarded-Proto=https value and pass Express HTTPS detection. Missing, duplicate, comma-separated, unexpected or untrusted forwarding information is rejected before authentication/database writes. Host/forwarded Host never determines the allowed Origin. No blanket trust proxy=true or hop-count assumption is used.

Azure ingress topology is unverified. Before deployment establish actual App Service hosting mode/peer identities, blocked direct access to the Node listener, HTTPS-only public ingress and reliable overwriting of client protocol/host/forwarding headers. Front Door/Application Gateway/additional proxies change these assumptions. If a reliable narrow boundary cannot be demonstrated, production deployment remains blocked pending a reviewed ingress design. Local proxy tests verify application behavior, not Azure's edge guarantees.

## Tests and evidence

The original 88 behavioral test cases remain, with only the approved logout call migration plus necessary strong-key/session-init setup. In test/api.test.js, the session invalidation and cart-survives-logout/login cases now use POST JSON; their security/cart assertions remain. Added raw-cookie replay proves actual server revocation separately from the helper's browser-cookie clearing. Existing UI network/HTTP failure cases remain; new frontend assertions pin POST JSON and single successful logout behavior.

Install the exact locked dependencies and Chromium explicitly (Linux CI adds --with-deps):

```sh
npm ci --ignore-scripts
npx --no-install playwright install chromium
bash scripts/start-test-postgres.sh npm test
npm audit --audit-level=high
```

The native helper starts a new loopback-only PostgreSQL 17 cluster with a disposable CA and server TLS, provisions the same restricted role/admin marker and always stops/removes the cluster. Linux Actions retains its postgres:17 service, enables verified TLS on that disposable container and proves the handshake before testing. Production-mode application tests use PGSSLMODE=verify-full and the disposable CA; test target/role/schema protections stay in place. Missing browser or test TLS setup fails tests rather than skipping them.

Chromium uses a local TLS proxy and mapped vinyl.test hostname to avoid localhost's Secure-cookie exceptions on HTTP. Only the browser's validation of the disposable proxy certificate is bypassed; PostgreSQL validation is never disabled. Browser tests serve the real frontend assets. Security assertions cover transport, cookie attributes, HttpOnly visibility, fixed expiry, logout, raw replay and HTTP rejection.

Local verification results and implementation deviations are recorded in the execution record below; no unexecuted Linux CI, Sonar or Azure result is claimed.

## Execution record (2026-10-15)

Base: verified origin/main cdd27340030fc771be9429a8c3b23003b5185f25 (PR #7), isolated branch feat/secure-persistent-sessions. Fresh baseline:88/88 passed. Local macOS Node v24.21.0 / PostgreSQL17 / real Chromium:114/114 passed, zero failures/cancellations/skips; npm audit reports zero vulnerabilities. A final independent review and any resulting fixes are recorded separately before owner handoff. No Linux Actions, macOS Actions, SonarCloud or Azure run has been claimed from these local results.

Implementation deviations/rulings:

- The app worktree API could not resolve the repository beneath its workspace wrapper. Git created the requested isolated worktree instead; it is not managed by the app's artifact list.
- npm and browser downloads use writable temporary caches, without changing the user's default cache.
- Task4's wiring and Task5's authentication transition had to be verified together: the strict store rejects the old handlers' missing authenticatedAt. Validation was kept strict rather than temporarily allowing unsafe sessions.
- Expiry deliberately detaches the request session. Anonymous checks in /me and requireAuth now safely accept that absent session, preserving anonymous/401 behavior instead of returning500.
- Proxy ranges are restricted to IPv4 /24–/32 or IPv6 /64–/128, closing broad explicit ranges that would defeat the narrow-peer requirement. Deployments needing larger ranges require review rather than an insecure fallback.
- Chromium uses mapped vinyl.test for HTTP cookie checks because localhost has special trustworthy-origin behavior. The test proxy's certificate validation bypass is limited to that browser fixture; database TLS remains verified.
- Readiness checks each DML privilege separately; PostgreSQL's comma-separated privilege list checks whether any listed privilege is available, not whether all are.
- Additional focused failure/lifecycle test files keep commit-then-error and real signal/deadline tests separate from ordinary authentication flows. The original baseline's88 behavioral cases remain covered.

Remaining deployment limits: Azure peer/header-topology evidence, runtime/migration credential separation, connection-budget/load assessment and operational backup/retention configuration. No Azure resources, push, PR, merge or auto-merge action was performed.
