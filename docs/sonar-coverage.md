# Test coverage and SonarQube Cloud (PR #9)

## Scope

The Linux `test` GitHub Actions job runs the same `node:test` suite with Node.js 24's
built-in experimental coverage reporter. It writes `coverage/lcov.info` and keeps
human-readable test output. The workflow checks that the report is nonempty and
publishes it as the short-lived `linux-lcov` Actions artifact. The existing
`test-macos` job, PostgreSQL 17 disposable database protections, verified TLS,
Chromium tests, npm audit and mandatory GitHub check names are retained.

To reproduce a coverage run locally **after** provisioning the same disposable
PostgreSQL test environment and installing Chromium:

```sh
mkdir -p coverage
npm run test:coverage
test -s coverage/lcov.info
```

Alternatively, use the existing native helper to create the disposable cluster:

```sh
mkdir -p coverage
bash scripts/start-test-postgres.sh npm run test:coverage
```

The LCOV file is generated evidence; it is ignored by Git. Do not commit
coverage artifacts or publish private source paths deliberately.

**Measurement limitation:** Node's native runner instruments the JavaScript
executed in its covered test processes. Separate HTTP server child processes
launched by integration tests, browser-executed JavaScript, and code never loaded
by those processes are not automatically included in the report. A successful
132-test run does not imply 100% application coverage. Check the actual
`SF:` paths in LCOV and the imported SonarCloud measures; improve measurement
scope in a separate reviewed change rather than claiming full E2E coverage.

## Transition from SonarQube Cloud automatic analysis

**The project currently relies on the SonarCloud app's automatic analysis**.
Automatic analysis cannot import a CI-generated LCOV file. The project owner
must switch analysis modes **only after** verifying that the new CI scanner is
ready. The existing required `SonarCloud Code Analysis` check and repository
ruleset must not be disabled or renamed.

1. In SonarQube Cloud, open the existing project
   `bakadja_vinyl-shop-fullstack-auth`, go to **Administration →
   Analysis Method**, and turn **Automatic Analysis OFF**. Do not create
   a second SonarCloud project.
2. Generate a project-scoped analysis token with **Execute Analysis**
   permission. In GitHub repository **Settings → Secrets and variables →
   Actions → New repository secret**, create `SONAR_TOKEN`. Never print,
   commit or paste the token in chat, the repository or CI logs.
3. In the same GitHub Actions settings, create a **repository variable**
   `SONAR_CI_ENABLED` equal to `true`. Until this variable is set, the
   `sonar-coverage` job intentionally does not run, preserving automatic
   SonarCloud analysis.
4. Trigger a fresh run of this pull request's workflow after both settings
   are in place. Confirm Linux `test`, macOS `test-macos` and the
   **SonarCloud Code Analysis** check on the exact latest PR commit.
   Confirm that the scanner imports `coverage/lcov.info` and examine
   actual coverage values and the Quality Gate. A nonempty file alone does
   not prove successful import.
5. Verify that scanner-side project key/organization match the project and
   that no duplicate automatic analysis remains active. Verify that push
   events on `main` subsequently update the coverage for the main branch.

The CI-based scanner is a **separate job** depending on the unprivileged Linux
test job. It downloads the LCOV artifact and does not install dependencies or
execute application tests with `SONAR_TOKEN` present. It does not run for
pull requests originating from forks. Its source checkout has read-only token
permissions. This boundary reduces (but does not eliminate) risk from
analyzing untrusted repository changes.

The existing required SonarCloud check may be temporarily absent during the
manual transition. **Do not merge** the PR until the CI-based analysis
reports successfully on the exact head and branch protection recognizes the
same required check.

## Why we do not enable the scanner immediately

SonarQube Cloud documentation states that automatic analysis and CI-based
scanning are mutually exclusive. Running both will fail the CI analysis. A
missing `SONAR_TOKEN` also makes scanning impossible. We therefore prepare
the configuration in the Draft PR but keep activation under the repository
owner's control.

Documentation:
- https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/javascript-typescript-test-coverage
- https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/overview-of-integrated-cis
- https://nodejs.org/docs/latest-v24.x/api/test.html

No SonarCloud administration, GitHub secret, repository ruleset, Azure resource
or deployment change is performed by this PR.
