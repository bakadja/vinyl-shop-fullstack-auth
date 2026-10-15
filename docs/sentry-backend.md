# Backend error monitoring (Issue #14)

Node.js 24 / Express 4 / ESM; pinned `@sentry/node` 11.8.0. Backend only.
The existing Sentry organization/project is `baki-dev/vinyl-shop-api`.
The issue contains the essential requirements of the original preparatory plan.

## Runtime configuration

Supply `SENTRY_DSN` only through approved environment injection. Never put a real
DSN/token in Git, a command argument, a PR, a test fixture or a screenshot.
`SENTRY_ENVIRONMENT` accepts `development`, `test`, `staging`, `production`.
`SENTRY_RELEASE` must be the full lowercase 40-character Git SHA in a source
checkout. Missing DSN, malformed configuration or missing/invalid release disables
telemetry without preventing startup. Application/session/DB configuration still
fails closed exactly as before.

`npm start` preloads `instrument.js` with `--import`; `server.js` also imports it
first, so direct launches and existing workers initialize before Express/pg.
No `.env` file is read by Sentry itself; Node's existing env-file startup remains.

The Azure runtime assembler requires the exact `GITHUB_SHA` and writes an immutable
`release.json` into the allowlisted package. The preload uses that packaged release
instead of a potentially stale process setting. It is excluded from source control
by never generating it in the checkout root. Only the ignored runtime build directory
receives it. A missing/corrupt packaged manifest leaves source-checkout env behavior;
operators must not hand-edit or remove release metadata from a verified artifact.

Azure Bicep prepares `SENTRY_DSN` as a Key Vault reference to the existing vault's
`sentry-dsn` secret and sets `SENTRY_ENVIRONMENT=production`. This PR does not create
the secret, change RBAC, provision resources or deploy. An unresolved Key Vault
reference is invalid SDK configuration and disables telemetry. Configure the secret
only after the owner privacy/quota review below. All six existing readiness gates
remain blocked and `deploymentEnabled` remains false.

## Privacy and capture policy

All SDK default integrations are disabled, including Express automatic capture,
HTTP/fetch instrumentation, PostgreSQL instrumentation, console breadcrumbs,
request data, context lines, local variables, sessions and module enumeration.
No SDK integration is installed. Two minimal process listeners capture fixed fatal
incidents for uncaught exceptions and unhandled rejections, preserving Node 24's
exit behavior with a bounded flush. Secondary failures during fatal flush are ignored
and cannot trigger the SDK's raw-console fallback. Neither listener prints the
original exception to application logs.

One response-finish listener reports each completed 5xx response, covering both
caught controller/store failures and errors passed to the Express error middleware.
Controllers never capture separately. Expected 4xx responses (including 400, 401,
403, 429) never trigger this listener; direct SDK captures of exceptions marked with
4xx `status` or `statusCode` are also dropped. Startup, shutdown and idle DB connection
failures use fixed operation names. Aborted responses that never finish are not
reported by this listener. Availability errors such as readiness 503 are included.

`beforeSend` reconstructs events from a strict allowlist; the transport repeats this
reconstruction *after* SDK envelope creation. Permitted event fields are SDK-generated
event ID/timestamp, platform, controlled environment/release, fixed exception text/type,
a fixed operation tag/fingerprint, and fatal/handled state. All original exception
messages, types, causes, stacks, paths, source lines, URLs, SQL, query parameters,
bodies, user data, cookies, headers, session IDs, arbitrary tags/context/extra and
breadcrumbs are discarded. This intentionally sacrifices original stacks and
fine-grained grouping; incident diagnosis uses operation, release and safe local
reproduction. Do not relax this policy without another privacy review.

SDK data-collection switches are explicitly closed. Tracing is sampled at zero;
OpenTelemetry setup is disabled; no profiling/replay SDK is installed. Logs and
metrics are discarded by their hooks (including SDK v11's default-enabled APIs).
The transport accepts only error-event items. It drops attachments, transactions,
profiles, sessions, logs, metrics, feedback and client reports, and rebuilds envelope
headers without dynamic sampling context, DSN, user data or baggage. Sentry's public
routing key is necessarily included in the SDK-generated ingestion request URL;
the request never includes application headers or cookies.

The SDK retains its bounded buffer and server rate-limit handling. Network attempts
use verified HTTPS (HTTP permitted only on 127.0.0.1 in `test`), no automatic retries,
no inherited proxy credentials, and a one-second total timeout including DNS/TLS.
Capture does not await the network. Shutdown flush waits at most 500 ms within the
existing ten-second shutdown deadline. An SDK flush success is not a receipt proof.
Fatal handlers exit with status 1 after a bounded flush, rather than continuing a
potentially corrupted process.

## Automated verification (no external Sentry traffic)

Run `npm ci --ignore-scripts`, `npm audit --audit-level=high`, then
`PG_TEST_BIN=/path/to/postgresql17/bin bash scripts/start-test-postgres.sh npm test`.
The helper owns a private cluster, a restricted role and disposable per-test schemas;
never substitute the application database. CI runs Node 24 on Linux and macOS with
TLS and browser regression tests.

`test/sentry-wire.test.js` receives actual SDK HTTP envelopes on loopback. It injects
fictional personal data into exception messages/stacks/causes, request URLs/body/headers,
scope/context/breadcrumbs/attachments, direct SDK calls and direct transport envelopes.
Assertions inspect complete request headers, URLs, serialized envelopes and item counts.
They cover both automatic fatal handlers, caught/propagated Express failures, omitted
4xx events, disabled non-error products, refused/hanging ingestion endpoints, missing
DSN and malformed DSN. `test/sentry-api.test.js` exercises actual backend routes against
disposable PostgreSQL and verifies unchanged sanitized responses plus one event per
caught/propagated DB failure. There is no `/debug-sentry` route in any deployed code.

## Before any real ingestion: owner review required

The current live service settings have **not** been verified by this implementation.
The owner has confirmed they are not yet approved; do not enable a live DSN or run the
real probe until all of the following are recorded outside this repository's secrets:

- Correct organization/project and region/data residency; permitted data and retention.
- Remaining error quota, reset date, shared organization allocation and project rate limit.
- Zero paid overages: applicable spend/volume caps, any trial behavior and alert settings.
  A free quota does not by itself prove zero potential spend. Do not upgrade a plan.
- Project/organization data scrubbing, default PII protections, IP collection/storage,
  sensitive-data rules, project access and issue alerts. Review event samples before
  production. Keep browser monitoring disabled.

Review these read-only settings in the authenticated Sentry dashboard with the owner.
Do not print a DSN or API token in evidence. Do not invent current quotas or retention.
If any setting cannot be verified, leave real ingestion blocked and report NO-GO for
live acceptance. Local loopback proof is not a claim of receipt in Sentry.

## Controlled one-event acceptance procedure

1. Finish the owner review above. Choose the controlled project
   `baki-dev/vinyl-shop-api` and an approved `test` or `staging` environment.
2. Inject the project's DSN through an approved external secret mechanism. Set the
   full reviewed commit SHA in `SENTRY_RELEASE`; never put its DSN value on a CLI or
   in a tracked file. Clear unrelated SDK configuration and do not run under production.
3. Only after those checks, set these non-secret attestations in the operator shell:

   ```sh
   export SENTRY_PROBE_PROJECT=baki-dev/vinyl-shop-api
   export SENTRY_PROBE_APPROVED=yes
   export SENTRY_PRIVACY_REVIEWED=yes
   export SENTRY_QUOTA_REVIEWED=yes
   export SENTRY_ZERO_SPEND_CONFIRMED=yes
   node scripts/sentry-probe.js
   ```

   Do not use `--import`/`NODE_OPTIONS` preloads for this CLI. It validates the
   attestations and target before initializing telemetry. The script is excluded
   from the runtime artifact, opens no HTTP route and queues one fixed synthetic error.
4. Record the printed event ID, exact SHA, environment and time. Inspect that ID in
   Sentry: exactly one event, expected operation `synthetic`, correct environment/release.
   Inspect the raw event for the allowlisted fields and absence of all sensitive data.
   Verify quota change and no spend. Do not keep repeating a failed probe: check receipt,
   rate limits and configuration first. SDK flushing alone does not prove delivery.
5. Remove the probe attestations/DSN from the operator environment. Do not enable
   production ingestion, unblock Azure gates or merge/deploy as part of this procedure.

## Official references checked for this integration

- https://docs.sentry.io/platforms/javascript/guides/express/
- https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/
- https://docs.sentry.io/platforms/javascript/guides/node/data-management/
- https://github.com/getsentry/sentry-javascript/releases/tag/11.8.0

Checked with the published SDK code and npm engine metadata: Node 24 is supported.
In SDK v11 collection/logging defaults changed; `sendDefaultPii: false` alone is not
a sufficient privacy policy. Keep wire-level regression tests when upgrading.
