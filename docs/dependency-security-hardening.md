# Dependency security hardening — PR #4

Baseline: merged `main` commit `66c0e94`, inspected 2026-10-14. Audit is a registry snapshot, not proof that all vulnerabilities are known or exploitable. Counts below represent vulnerable packages (including inherited findings), not independent CVEs.

## Audit before / after

| Severity | Before | After |
| --- | ---: | ---: |
| Critical | 2 | 0 |
| High | 12 | 0 |
| Moderate | 4 | 0 |
| Low | 2 | 0 |
| Total | 20 | 0 |

There are no devDependencies. `npm audit --omit=dev` has the same before/after findings as the full audit. SQLite installer/build packages belong to the production dependency tree (some are optional), but they are not called by the HTTP application. Do not equate `omit=dev` with runtime exploitability: installation is itself a security boundary.

| Package | Relationship | Before severity | Before version | After version | After audit | Exposure in this application |
| --- | --- | --- | --- | --- | --- | --- |
| @tootallnate/once | Transitive | low | 1.1.2 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| body-parser | Transitive | moderate | 1.20.3 | 1.20.8 | 0 findings | HTTP runtime (Express) |
| brace-expansion | Transitive | high | 1.1.11 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| cacache | Transitive | high | 15.3.0 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| express | Direct | high | 4.21.2 | 4.22.3 | 0 findings | HTTP runtime (Express) |
| http-cache-semantics | Transitive | high | 4.2.0 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| http-proxy-agent | Transitive | low | 4.0.1 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| ip-address | Transitive | high | 9.0.5 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| make-fetch-happen | Transitive | high | 9.1.0 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| minimatch | Transitive | high | 3.1.2 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| node-gyp | Transitive | high | 8.4.1 | 12.4.0 | 0 findings | Installation/build tooling (sqlite3) |
| path-to-regexp | Transitive | high | 0.1.12 | 0.1.13 | 0 findings | HTTP runtime (Express) |
| proxy-addr | Transitive | critical | 2.0.7 | 2.0.8 | 0 findings | HTTP runtime (Express); no trust proxy setting in application |
| qs | Transitive | moderate | 6.13.0 | 6.16.0 | 0 findings | HTTP runtime (Express) |
| socks | Transitive | moderate | 2.8.4 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| sprintf-js | Transitive | moderate | 1.1.3 | Removed | 0 findings | Installation/build tooling (sqlite3) |
| sqlite3 | Direct | high | 5.1.7 | 6.0.1 | 0 findings | Database runtime; reported vulnerabilities inherited from installation tooling |
| tar | Transitive | critical | 6.2.1 | 7.5.22 | 0 findings | Installation/build tooling (sqlite3) |
| tar-fs | Transitive | high | 2.1.3 | 2.1.5 | 0 findings | Installation/build tooling (sqlite3) |
| validator | Direct | high | 13.15.15 | 13.15.35 | 0 findings | Auth runtime; only isEmail is called, not the affected URL helpers |

Full advisory URLs, affected ranges, dependency effects and counts are preserved in the adjacent audit JSON snapshots. No vulnerabilities remain in either final audit, so there are no deferred findings or accepted exceptions.

## Version decisions and compatibility

| Direct dependency | Before | After | Decision |
| --- | --- | --- | --- |
| express | 4.21.2 | 4.22.3 | Compatible Express 4 minor release; no Express 5 migration |
| validator | 13.15.15 | 13.15.35 | Patch release; existing registration behavior verified |
| sqlite3 | 5.1.7 | 6.0.1 | Justified major update of native binding; see below |
| bcryptjs | 3.0.2 | 3.0.2 | Unchanged |
| express-session | 1.18.2 | 1.18.2 | Unchanged |
| sqlite | 5.1.1 | 5.1.1 | Unchanged wrapper and API |

Commands used: `npm install --package-lock-only --ignore-scripts express@^4.22.3 validator@^13.15.35 sqlite3@^6.0.1`, followed by `npm update proxy-addr tar-fs --package-lock-only --ignore-scripts`. The second command refreshes compatible locked transitives: proxy-addr 2.0.8 and tar-fs 2.1.5. No force command, override, or forced incompatible transitive replacement was used. The lock also resolves tar 7.5.22, optional node-gyp 12.4.0, and updated Express parsing/routing packages.

sqlite3 5.1.7 pins the old tar 6/node-gyp 8 installation tree. Moving to 6.0.1 removes obsolete build transitives and permits patched tar 7 and optional node-gyp 12 without forcing overrides against upstream API constraints. sqlite3 6.0.1 requires Node >=20.17.0; node-gyp 12.4.0 requires ^20.17.0 or >=22.9.0; tar 7.5.22 requires >=18. Node 24 satisfies these requirements. The major version raises the supported Node floor and changes native/build dependencies; it is not assumed universally nonbreaking. Existing schema, authentication, persistent cart, isolation and DOM tests are retained and exercised.

Upstream [sqlite3 documentation](https://github.com/TryGhost/node-sqlite3) describes Node-API binaries and source-build fallback. The [6.0.1 release](https://github.com/TryGhost/node-sqlite3/releases/tag/v6.0.1) publishes Linux and macOS arm64/x64 binaries. The repository is archived, which is a future maintenance risk; this PR does not migrate database technology. A missing binary/network failure requires a C++ build toolchain, Python and optional node-gyp. The verified paths below use the supplied binaries; source-build fallback is not independently certified.

## npm installation scripts / SonarQube

SonarCloud main issue `AaE76hVRkrbj8BU8kZQw`, rule `githubactions:S6505`, reported: omitting `--ignore-scripts` allows lifecycle scripts during `npm ci` in the workflow. This is an open issue, not a Security Hotspot (the main hotspots API returned zero). No rule, gate, exclusion or issue resolution was weakened.

The final lock contains one package with an installation hook: sqlite3 6.0.1. Its reviewed hook is `prebuild-install -r napi || node-gyp rebuild`: download and extract a platform native binary, or compile bundled sources. `lib/sqlite3-binding.js` loads the native module via bindings; `lib/sqlite3.js` uses built-in modules and that binding rather than tar/fetch/proxy build helpers. Risks include execution with runner permissions, external binary supply chain, archive extraction and fallback compilation. The npm lock integrity covers npm tarballs, not independently the GitHub release binary. Updated tar/tar-fs address known extraction vulnerabilities, but a clean audit is not a supply-chain authenticity guarantee.

Both CI jobs now install with `npm ci --ignore-scripts`, then explicitly run `npm rebuild sqlite3 --ignore-scripts=false`. This executes the reviewed package lifecycle hook only; newly added dependency hooks do not run implicitly during CI installation. Downloaded native code remains executable, and the rebuild intentionally retains that necessary risk. CI has read-only contents permission, does not persist checkout credentials, and uses existing Node 24 setup. A global `ignore-scripts` setting without the explicit rebuild would leave SQLite unusable.

Local plain `npm ci` remains supported and was verified. npm 11.19.0 emits an allowScripts review warning for sqlite3; it does not fail installation. No npm-specific approval configuration or global allow-all setting was added. Deployments should use the same reviewed two-stage installation where possible.

## Verification

- Baseline: all existing 29 tests passed on macOS arm64 / Node v24.21.0.
- Final plain `npm ci`: successful; SQLite native binding loaded and SQL reported SQLite 3.52.0 on macOS arm64.
- Hardened `npm ci --ignore-scripts` + `npm rebuild sqlite3 --ignore-scripts=false`: successful; all 29 tests passed, zero failures/skips.
- `npm audit` and `npm audit --omit=dev`: zero vulnerabilities after updates.
- `npm ls --all`: successful, no invalid dependency tree; `git diff --check`: successful.
- GitHub Actions: Linux job keeps required check name `test`; macOS adds `test-macos`. Both run native SQLite smoke query and all 29 existing tests on Node 24. Remote results are recorded in the PR after execution.
- SonarCloud Quality Gate: remote PR result recorded after analysis. No Sonar settings are modified.

This branch changes dependency manifests, CI installation/platform coverage and evidence only. No business functionality, existing tests, schema or secrets are changed. Draft review only; do not merge without the owner's validation.
