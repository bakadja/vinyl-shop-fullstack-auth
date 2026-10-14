# Backend and frontend reliability hardening

## Scope and baseline

Based on `main` at `0593c12`, after PRs #1–#5. The original 29 Node.js tests pass. The application remains Node.js 24, Express 4, SQLite, express-session and browser ES modules. No dependency versions, schema, session architecture, GitHub rulesets or Sonar rules were changed.

## Problems, causes and resulting behavior

| Area | Before / root cause | After |
| --- | --- | --- |
| Cart product IDs | `parseInt` accepted partial strings, fractions, zero and negative values. Missing products could create hidden cart rows counted by the badge. | Accept positive safe integer numbers or canonical decimal strings only. Invalid values return JSON 400; absent products return JSON 404 without insertion. |
| Cart consistency | Separate lookup and insert could create duplicate lines under concurrent requests. | A single SQLite `INSERT … SELECT … ON CONFLICT(id) DO UPDATE` checks the catalog and atomically inserts/increments the user's line. Connections close in `finally`. No schema migration is required. |
| Item deletion | Partial IDs could delete a real line. | Apply the same ID validation; one user-scoped DELETE checks affected rows. Preserve JSON 400 for missing/foreign items to retain the existing API contract and avoid disclosing ownership. Successful deletes remain 204; additions remain 200. |
| Basket action | The page announced order processing immediately, even on failure, although the API only deleted cart rows. | Label the action **Clear cart** and explicitly explain that no order/payment is processed. Await DELETE 204 before success. Preserve visible rows and total on HTTP/network failure; show a safe error and allow retry. Suppress overlapping cart mutations and duplicate add/logout clicks. |
| Catalog | `applySearchFilter` referenced an unimported function. Separate frontend paths and backend `else if` prevented combined filters. | Import the service; use one filter path for initial load/search/genre. Combine exact genre with parenthesized title/artist/genre LIKE search. Empty filters restore the catalog; empty arrays render safely. Reject non-string query filters with 400. |
| Search races | Earlier requests could overwrite later input. | A monotonic request identifier allows only the latest request to render either results or an error, including initial load. |
| HTTP/network failures | Product services parsed error JSON as successful data. Initial/event Promises could reject without handling. Logout's catch referenced an undefined variable and redirected even on HTTP failure. | Check HTTP status and catalog arrays. Render safe retry feedback; disable unavailable genre filtering while keeping search usable. Handle service/event failures and retain the current page when logout fails. |
| Express 4 failures | Rejected async cart controller Promises bypassed error middleware and could terminate the process. Product errors included database details. Authentication could throw on non-string fields before its try/catch. | Wrap all async API controllers with rejection forwarding; return sanitized JSON 500 for unexpected errors, JSON 400 for invalid bodies and 413 for oversized bodies. Validate authentication field types before trimming. Handle session destruction callback errors. |

Authentication middleware and every cart query remain scoped to the session's user ID. Existing safe `createElement`, `textContent`, attribute assignment and `replaceChildren` rendering is preserved. The existing unauthorized-cart DOM fixture now includes the real HTTP 401 status; none of its assertions were removed.

## Regression tests

Added 26 focused tests, bringing the suite from **29 to 55**:

- Seven HTTP integration tests with real isolated SQLite databases and session cookies: malformed/missing/unsafe IDs, nonexistent products and direct row-count checks, 12 simultaneous numeric/string additions, malformed delete IDs preserving the cart, combined/cleared filters, authentication type errors, and database failures across all cart/catalog endpoints with server survival and no internal details.
- Nineteen browser-module tests using the existing minimal DOM double and controlled network responses: clear failure/success/pending/duplicates and follow-up refresh failure; cart load/re-enable; combined/cleared filters; stale success/rejection; catalog HTTP/network and genre failures; cart icon HTTP errors; add failure; logout HTTP/network failures; actual cart page click wiring; successful add retry feedback; catalog bootstrap racing a user search.

The new regressions were run against the broken behavior before fixes. They exposed acceptance of malformed IDs, orphan rows, concurrent duplicate lines, incorrect combined results, server disconnects after async errors, the missing import and premature checkout success. The DOM double rejects HTML parsing sinks. Original database/API/XSS assertions remain in place.

## Validation

Local validation on macOS with Node.js `v24.21.0`:

| Check | Result |
| --- | --- |
| `npm ci` | Passed; locked dependencies installed. npm reports sqlite3's existing native install script for review. |
| `npm audit --audit-level=high` | Passed; zero vulnerabilities. |
| `npm test` | Passed: 55 tests, zero failures/skips. |
| GitHub Actions `test` (Linux) | Pending draft PR run. |
| GitHub Actions `test-macos` (macOS) | Pending draft PR run. |
| SonarCloud Code Analysis / Quality Gate | Pending draft PR analysis. |

Remote results will be recorded in the draft PR description after the checks complete. This document records implementation and local evidence; the PR's checks identify the exact analyzed commit.

## Remaining limitations

- No checkout, orders, payments, stock reservation or processing exists. Clearing a cart is the only supported basket-wide action.
- Existing manually corrupted/orphaned/duplicate database rows are not automatically repaired. Atomic writes prevent new duplicate lines through this API from a consistent starting database; direct database writers remain outside that guarantee.
- If a DELETE commits but its response is lost, the browser conservatively retains its visible cart and reports failure; refresh reconciles with the server. There is no distributed transaction between browser and SQLite.
- Request sequencing ignores obsolete responses but does not cancel network work or add debounce. Existing SQLite LIKE wildcard/case behavior is retained.
- Frontend tests exercise real modules with a minimal DOM contract double, not a full browser/layout engine. HTTP tests exercise real Express and SQLite in child processes.
- Session storage, deployment settings and broader authentication/security architecture remain outside this reliability PR.
- This PR stays in draft and must not be merged without repository owner review and approval.
