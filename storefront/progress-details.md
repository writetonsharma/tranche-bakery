# T004 progress — 2026-10-26

- Implemented independently from current backend contracts and public HTML; no
  parked work/repo memory was consulted. Only the website repository was edited.
- Added disabled-by-default config, strict model/exact product bindings, isolated
  same-origin API client, native-dialog view, controller, olive CSS and Node tests.
  The sole public-page change adds three asset tags in the head; no existing
  content, images, links or JavaScript was replaced.
- Server-only quote amounts/date, bounded ID/quantity-only persistence, request
  generation/abort protection, immediate stale-total clearing, cookie/CSRF login,
  replacement tokens, resend/expiry/busy states and generic failures implemented.
- Native-dialog top layer owns focus trap/background inertness; separate root scroll
  lock avoids existing nav/detail-modal classes and history. Reduced-motion styling
  and explicit close/Escape/backdrop/focus restoration included.
- Decomposition verdict: atomic frontend T004. No scenario skill root, Execution
  index/hints, task.md path or task-related skills were forwarded. Skill discovery
  returned no match and no applicable Execution extension. Research and execution
  reference was written to README before source edits; no task folders were created
  and no backend planning file was changed (website-only restriction).
- Initial self-check: Node v24.21.0, 23/23 tests passed, zero failures/cancellations/
  skips. `node --check` passed for all new JS/MJS (including test); `git diff --check`
  passed. VS Code diagnostics reported no errors. Follow-up close invalidation and
  backdrop/reduced-motion edits require the final repeated check below.
- No server, dependency install, deployment, provider message, push/reset or bundle
  operation performed. Browser validation and final security review explicitly remain
  with parent; detailed selectors/mock cases and staging gates are in README.

## Final repeated self-check

- After close-state invalidation, animated backdrop/reduced-motion styling and honest
  unknown-session handling: **23/23 Node tests passed**, zero failures, cancellations
  or skips. All **6 JavaScript/module syntax checks passed**. Whitespace validation
  passed and diagnostics for all implementation files reported **0 errors / 0 warnings**.
- Verified the complete tracked public-page diff is exactly three added asset tags.
  All other deliverables are new files under this repository's storefront directory.
- README includes rollout/injection instructions, exact stable selectors and eight
  groups of mocked-browser/accessibility/security checks for the parent's next phase.
  No browser/server run or production integration was performed or claimed.

## Parent validation and corrections

- Fixed the real backend CSRF header contract to X-XSRF-TOKEN in client, fixtures
  and docs; the old header is explicitly rejected in regression tests.
- Quantity values now expose labelled polite status announcements. Added a view
  regression test and explicit Escape key handling (verified in integrated browser).
- Final automated suite: 24 passing tests; module syntax and whitespace checks pass.
- Browser tested with a temporary loopback-only fake API, never a production proxy:
  default-disabled zero API requests/no launcher; 20 mapped cards; add/persist/reload;
  delivery date and server quote; fake OTP challenge/verify/logout with replacement
  CSRF and personalised credit; totals cleared on logout and synthetic offline;
  Escape and backdrop close, initial/restored focus and Tab wrap; reduced-motion;
  desktop 1440px, mobile 390px and narrow 320px, no horizontal overflow.
- Local source review found no additional concrete blockers after corrections.
  Hosted Vercel/Railway integration and real delivery/accessibility audit remain
  unperformed staging gates. This is a preview, not checkout or a launch approval.

## User-approved live-test connection follow-up

- User explicitly requested live-site testing after deployment, not a separate
  staging site. This supersedes earlier frontend-disabled/staging-only notes above.
- config.js now enables only exact HTTPS www/apex bakery origins. Local and Vercel
  preview URLs remain off. Root vercel.json proxies only six exact customer API
  paths to the existing Railway host, every rule restricted to the bakery hosts.
- No broad API/admin/webhook proxy, separate backend or frontend secret. API and
  CDN no-store/rewrite-cache disable plus no-store assets support safe reloads.
- Five new config/routing/cache tests bring the suite to 29 passing; syntax and
  whitespace checks pass. Repeated backend clean suite: 250 passing tests.
- Fresh browser: unmodified local config is false, zero API requests/no launcher.
  Test-only injection against fake loopback APIs verifies 20 mapped cards,
  date/quote, fake OTP/login/logout, personalised credit and clearing totals.
- DEPLOYMENT.md contains exact Railway variables and rollout/check/rollback order.
  Hosted Set-Cookie, Origin/CSRF, CDN behaviour, proxy-IP attribution and real Meta
  delivery remain pending the user's deployment and manual test. No source push,
  production API call, message, payment or deployment performed here.

## T006 frontend — independent default-off durable checkout (2026-10-26)

- Website-only implementation; read authoritative replacement backend contract.
  Recorded verified scope in README before source edits (no task.md, assessment or
  scenario skill root was supplied; none invented). Execution extensions: none.
  Decomposition assessed: specific frontend feature, implemented as pure contract,
  coordinator, isolated UI and integration/routing boundaries with tests first.
  Runtime Modernizer harness unavailable; explicit requested Node/mock checks used.
- Added checkout-model, checkout-flow, checkout-view and checkout test module;
  updated API/config/controller/view/CSS/routing tests/Vercel and docs. Backend,
  root bundles, parked work, original photos, public content and galleries untouched.
- Default false independently gates new DOM and endpoint access. Existing exact
  production preview-origin behavior preserved. Account load/save are explicit;
  versions, exact quantities/dates and stale-cart conflicts fail closed with consent.
- Prepared server quote and fulfillment are reviewed before explicit Confirm & Pay.
  UUID/payload immutable in memory; no unsafe automatic retry. Uncertain POST keeps
  the same key even when recovery bootstrap fails. Owned-ID-only bounded visible
  polling, safe provider URL parsing and server-only PAID. Credits/zero/unknown/
  review/unavailable states honestly route to support; no credit consumption or QR.
- Reviewer findings fixed with regressions: recovery bootstrap losing original key;
  identity mismatch not clearing outer personalised totals; rejected quote fallback
  showing stale totals. Unknown/review states preserved beyond expiry. Cart edit,
  close/offline/hidden/cross-tab abort late work and hide private displays immediately.
- Mock DOM evidence exercises selectors sf-cart-load → sf-prepare → sf-delivery
  submit → sf-confirm-pay → sf-payment-link / sf-checkout-refresh, proving fixed
  reviewed details despite hidden input mutation, owned GET and link/quote/details
  removal on pause/logout. Fake fetches prove exact methods/CSRF, 409 no blind retry,
  same-key lost-response recovery, off-flag zero durable calls and bounded polling.
- Validation checkpoint: 57/57 Node tests passed, 0 failures/skips/cancellations;
  all 11 JS/MJS syntax checks and git diff --check passed. Editor diagnostics 0/0.
  No real browser engine installed in repository; mock DOM is not layout/native
  dialog/accessibility proof. No hosted Vercel routing, cookie integration, backend
  finalization, real OTP or provider/webhook validation claimed. No push/deploy.
- Final review correction: retain the immutable accepted quote inside the attempt,
  not only its token. Explicit same-attempt recovery after basket edits displays
  the original order lines/date/total and delivery snapshot, distinctly labelled
  from later edits, before exposing its payment link. Mock DOM asserts both the
  immediate hiding on edit and correct original-quote redisplay on owned recovery.
- Terminal isolation caveat: the shared active shell initially surfaced an existing
  backend batch's “Terminate batch job” prompt during a requested frontend command;
  it was answered Y before the backend ownership collision was recognized. No
  backend source was edited or backend command intentionally issued. Subsequent
  frontend validation was delegated with explicit no-backend-interruption guards.
  Separately running backend validation may need its owner's restart; this report
  makes no claim about that run.

## P2 retired account lines — research / execution reference (2026-10-26)

- Scope verified before source edits: checkout-model currently applies current
  catalogue membership to server GET lines, blocking both Load and first Save.
  Backend WebCartService.get deliberately retains persisted IDs/version and returns
  quote:null with problems when current catalogue validation fails. PUT validates
  the replacement lines, not membership of the previous persisted lines.
- Plan: factor exact bounded line structure from catalogue membership; accept only
  structurally valid server lines, keep strict membership for outgoing/local lines.
  An explicit Load containing unavailable IDs retains the entire local basket and
  account version, explains that nothing was loaded/removed/merged, marks local edits
  unsaved, and permits explicit Save to replace using that version. No partial load,
  silent filtering or clearing. Conflicts still block Save until explicit Load.
- Atomic verdict: one frontend contract/recovery correction plus focused Node
  regressions. No scenario root, Execution/hint files, assessment or task.md was
  supplied; none invented. Execution extensions returned none. Discovered runtime
  validation guidance read; runtime execution is expressly forbidden by the parent.
- Only website files will change; no commands, builds or tests will be executed.
  Existing feature flags, API/CSRF/routes, attempt recovery and preview stay intact.

### P2 implementation / handoff

- Added validateLineStructure and kept validateLines as strict current-catalogue
  validation for local persistence, edits and outgoing cartInput. validateCart now
  validates persisted lines structurally, plus exact version/date/quote contracts.
- Load retains all local lines/date when any persisted ID cannot be represented,
  records the server version, reports the unavailable basket explicitly and blocks
  Prepare via unsaved state. Explicit Save replaces, never merges. First Save can
  fetch a retired basket's version and replace it with its original local snapshot.
- Added regressions for retired/mixed lines, malformed schema/versions/quotes,
  outgoing ID rejection, first-Save version/snapshot, Load preserving empty and
  different baskets, conflict → explicit Load → explicit Save, and mock DOM status,
  Save availability / Prepare blocking / no payment link. Existing flag/API tests
  remain in place. No other concrete mismatch required changes in this narrow review.
- Editor diagnostics: no errors reported in the four changed source/test modules.
  No terminal commands, builds or tests executed, as required; no passing runtime
  claim. Parent should run `node --test storefront/tests/*.test.mjs` from the website
  repository (or just the checkout test module first).
- Files changed: model.mjs, checkout-model.mjs, checkout-flow.mjs,
  tests/checkout.test.mjs and this append-only progress record, all under storefront.
  No backend, root docs, config/routing, bundles or live-preview flags changed.
  task.md not written: none was supplied or found inside the allowed repository.