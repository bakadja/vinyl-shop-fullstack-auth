# Secure sessions: independent review and final verification

Date: 2026-10-15. Execution method: native sequential implementation, followed by one fresh-context independent reviewer. No implementer agents were used.

## Review scope and result

Independent reviewer inspected cdd27340030fc771be9429a8c3b23003b5185f25..2776ff86fdcb91ed63142f939f924132eee46c64 read-only, including the approved specification, plan, execution rulings, source, tests and CI/TLS configuration. It reproduced two important defects; no critical defects were reported. The reviewer did not independently rerun the full suite or audit. The author reproduced and fixed findings in one pass, with regression evidence below; a second independent review was not performed.

| Finding | Reproduction | Resolution / verification |
| --- | --- | --- |
| Mapped IPv6 CIDR hides broad IPv4 trust | ::ffff:0.0.0.0/96 and ::ffff:10.0.0.0/104 passed the IPv6 prefix policy | Canonicalize IPv6 address notation with Node SocketAddress; reject mapped CIDR configuration and require ordinary IPv4 CIDRs. Tests reject mapped /96,/97,/104 in dotted/hex/expanded forms and retain narrow IPv4-mapped peer matching. Observed missing-exception RED before correction, GREEN afterward. |
| Middleware performs a second authentication save after awaited regeneration/save | Real Express/session plus pg interception counted two upserts; failure injected on the second occurred after success headers | Store retains a WeakMap acknowledgement for the exact in-flight Session object and unchanged non-cookie payload/SID. Its repeated save callback succeeds without another DB write. Changed identity still persists, fixed cookie expiry is capped, and every read still goes to PostgreSQL. Observed two-versus-one RED before correction; final test commits once with no late error despite an injected would-be second-write failure. Existing commit-then-error/cleanup test remains green. |
| Accepted prune/timezone verification gaps (reviewer labeled minor) | Earlier drain test gated set, not prune; tests did not alter PostgreSQL timezone defaults | Regraded as important acceptance coverage and completed: real prune blocked behind a PostgreSQL table lock keeps close pending until drained, timer remains stopped, caller pool remains usable; native test cluster defaults to Pacific/Auckland while application connections enforce UTC. Absolute expiry remains eight hours under non-UTC observer/default settings. |

The write acknowledgement is not a session cache/MemoryStore fallback: it never authenticates a request, serves a read, survives the Session object's lifetime or crosses requests. Regenerated middleware instances can still invoke the public save API at response completion, but unchanged acknowledged identity generates no subsequent persistence operation. This uses public store methods rather than changing express-session's private savedHash/originalId state or implementing cookie signatures ourselves.

## Final local verification

- Fresh base: fetched origin/main and verified remote main at cdd27340030fc771be9429a8c3b23003b5185f25, PR #7.
- Original baseline:88 passed,0 failed,0 skipped.
- Clean locked install: `npm ci --ignore-scripts` succeeded (writable temporary npm cache).
- Final full test command: `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/vinyl-playwright bash scripts/start-test-postgres.sh npm test`.
- Final result:118 passed,0 failed,0 cancelled,0 skipped; approximately14.2 seconds reported by node:test.
- Local environment: macOS, Node v24.21.0, PostgreSQL17.11 Homebrew, actual Playwright Chromium.
- Final `npm audit --audit-level=high`: zero vulnerabilities, including development dependencies.
- Whitespace checks passed; no real secrets/.env/database contents were committed.

The suite preserves the original88 behavioral cases, including bcrypt, validation, cart isolation and PostgreSQL fixture safety. Only the approved logout calls change method in baseline tests; necessary startup setup supplies strong keys and initializes the new table. Added tests cover configuration, transport, cookies/browser UI, fixation, replay, explicit-save failure including commit-then-error, exactly-once persistence, restart/worker persistence, rotation, fixed expiry, store outage/recovery, POST Origin/content policy, safe GET/HEAD rejection, schema/data/cleanup safety, wrong CA, and normal/deadline shutdown.

## Declined-to-judge items and owner boundaries

- Live Linux/macOS Actions and SonarCloud status were not available to the reviewer or asserted by the implementer. Existing Linux/macOS job names and checks are preserved; TLS and Chromium setup is added. Live CI must run after separately authorized publication. Cost of proceeding without that evidence: platform/service setup regressions could remain undiscovered.
- Azure ingress identities/header sanitation remain unverified. Local tests verify application behavior only. Deployment requires evidence of actual trusted peers, exclusive ingress and header overwriting. Cost of ignoring this gate: spoofed forwarded protocol could cross an incorrectly configured trusted boundary.

No remaining review finding is deferred. The coverage finding was completed as acceptance work; the two important runtime defects were regression-tested after correction. No push, PR, merge, auto-merge, Azure provisioning or deployment occurred. Owner approval is required before any publication.

## Execution rulings and costs

- Git fallback worktree instead of app-managed worktree: the app tool could not resolve the repository under its wrapper. Isolation from verified main is preserved; cost is manual worktree lifecycle management.
- Temporary npm/browser caches: default cache was outside writable roots. No user cache modifications; cost is redownloading dependencies/browser binaries.
- Task4/5 combined verification: strict storage rejects the legacy missing authenticatedAt. No temporary security bypass; cost is that the intermediate Task4 commit is not independently releasable.
- Absent-session anonymous guards: expiry detaches req.session. /me and requireAuth now use optional access; cost if wrong would be altered anonymous handling, covered by expiry/replay/cart tests.
- Narrow CIDR prefix policy plus mapped-notation rejection: IPv4 /24–/32, native IPv6 /64–/128; mapped peers configured using IPv4 notation. Cost is reviewing deployments requiring broader ranges or translating mapped CIDR notation.
- Mapped vinyl.test browser host: avoids localhost's special Secure-cookie HTTP exception. Browser proxy certificate validation alone is bypassed; cost is no production PKI guarantee from this fixture. Database TLS remains verified.
- Request-object write acknowledgement: prevents framework-induced unawaited duplicate upserts. Cost if wrong would be suppressing a required update; tests retain changed-identity writes, fixed expiry and all PG reads/outage checks.
- Prune/timezone gap regraded to acceptance work: native fixture now uses a non-UTC default and a real blocked prune. Cost is slightly more test runtime and a deliberately different server timezone from application UTC.

Execution records are preserved in the ignored .superpowers/sdd/2026-10-15-secure-sessions directory. Automatic approval review rejected irreversible cleanup of the ledger/review artifacts without explicit approval; no deletion or workaround was attempted.
