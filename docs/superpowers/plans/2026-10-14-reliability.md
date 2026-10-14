# Reliability Hardening Implementation Plan

Goal: Correct cart, catalog and asynchronous failure behavior while preserving Express 4, SQLite, sessions and the existing DOM rendering.
Spec: PR #6 requirements supplied in this chat.

Global constraints: Node.js 24; no dependency changes, payment/order processing, unsafe HTML sinks, infrastructure changes or automatic merge.

- [x] Backend regression cycle: HTTP tests for strict positive safe IDs, nonexistent products, concurrent additions, combined filters, malformed auth bodies and database failures. Run tests RED, implement validation, atomic cart writes and Express 4 error forwarding, then run the full suite GREEN.
- [x] Frontend regression cycle: DOM/network tests for clear-cart pending/success/failure, duplicate suppression, combined catalog filters, stale responses, HTTP/network failures and logout. Run RED; implement checked responses, safe feedback and latest-request rendering; run full suite GREEN.
- [ ] Review failure paths and user isolation, document before/after behavior and limits, run npm ci/audit/test, create the requested draft PR and verify Linux/macOS/SonarCloud on the final head. Never merge.

Review focus: duplicate concurrent cart additions; stale initial catalog responses; failed clear with visible cart preserved; non-string query/body inputs; database failures with no internal details.

Execution: inline in the requested branch; the user's instruction to implement and create a draft PR authorizes execution without an additional plan approval step.

Independent read-only review: no Critical/Important findings. Two minor findings addressed: stale add failure feedback (new test RED then fix) and bootstrap race coverage (new integration regression).
