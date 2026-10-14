# DOM XSS audit and regression checks

## Findings and changes

The browser code in `public/js` was reviewed for dynamic text, attributes,
URL properties and HTML/code parsing sinks.

| Rendering boundary | Previous risk | Fix / assessment |
| --- | --- | --- |
| Cart rows (`cartService.js`) | API title, quantity and cart item ID interpolated into `innerHTML`; tags and quoted attributes could become DOM markup | Explicit elements, `textContent` and `dataset.id` |
| Cart banner (`cartService.js`) | Count interpolated into `innerHTML` after a numeric comparison | Explicit fixed link/image; count appended as a text node; comparison unchanged |
| Product cards (`productUI.js`) | Title, artist, price, genre, image and ID interpolated into HTML, including quoted attributes | Explicit elements, `textContent`, `src`, `alt`, `dataset.id` |
| Cart total, loading error and login prompt | HTML assignment, including static markup | `textContent` or explicit elements; fixed login destination retained |
| Greeting, genre options, login/registration error messages, checkout message | Already use `textContent`; genre values use `value` | Retained |
| Redirects and navigation | Fixed destinations | Retained |

There are no remaining HTML parsing sinks in `public/js`. The product image
uses the existing `./images/` prefix and an image `src` property; quotes in the
filename cannot create attributes. This does not validate image filenames or
prevent URL path traversal/network requests; those are separate concerns.
No dynamic event handler attributes or JavaScript evaluation were found.

CSS, element order, class names, labels, totals, request payloads and event
registration remain unchanged. An explicit space between the cart title and
remove button preserves the former whitespace between inline elements.

## Automated tests

Run `npm test`: **29 tests pass**, comprising the unchanged 19 database/HTTP
tests and 10 new DOM contract tests. Before the fix, 8 of the 10 new tests failed;
the two tests covering existing safe rendering and DELETE/reload behavior passed.

Synthetic data includes `<img onerror>`, `<script>`, quotes, ampersands and
attribute-breakout payloads. Assertions verify literal text/attribute values,
cart quantities and totals, empty/stale states, navigation, login/error paths,
add-to-cart payloads and DELETE/reload behavior.

The tests use a small DOM double that rejects HTML parsing sinks. It verifies
rendering contracts without adding dependencies, but is not a browser or HTML
parser. A deliberately coercible count object tests the rendering boundary;
it is defense-in-depth test data, not a value obtainable from JSON.

## Real-browser check

Run `node test-support/dom-xss-browser-server.js`, then open the printed loopback
URL. The fixture imports the production rendering modules, substitutes synthetic
API responses and reports **PASS 8/8** in the Codex integrated browser.
It checks literal HTML, inert quoted attributes, totals/navigation, absence of
injected nodes/event handlers and a zero execution marker after a short delay.
The server serves only this fixture and JavaScript modules on `127.0.0.1`; it
never starts the application or opens its database. Stop it with Ctrl+C.
This check is manual and is not part of GitHub Actions. It is a targeted rendering
check, not a full end-to-end browser suite or a pixel comparison.

## Scope and remote verification

No dependency/lockfile, backend, database, PostgreSQL, Azure, Sentry, GitHub
security setting or Sonar exclusion is changed. Numeric validation and unrelated
pre-existing behavior are outside this rendering fix.

The Draft PR records the GitHub Actions and SonarQube Cloud results for its head.
A successful test run alone does not establish a passing Sonar quality gate;
a neutral/missing/unavailable analysis is reported explicitly. No merge is
performed; merging requires the repository owner's validation.
