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

## Account / automatic basket / payment-return next phase — 2026-10-27

- Research recorded before source edits in account-nextphase-task.md. Read the
  authoritative current backend account contract and actual OrderStatus enum.
  No scenario skill root, Execution/hint files, assessment or task.md was supplied;
  skill discovery returned no match and no applicable Execution extensions.
  Independent account UI and transport/test concerns were delegated; integrated
  acceptance/basket lifecycle stayed with one owner. No lifecycle tools called.
- Added account.html, storefront/account.css, account-model.mjs and account.mjs;
  normal index/breads/about/faq navigation and checkout link to My account. The
  logged-out page links to the existing WhatsApp sign-in drawer without PII.
  Explicit five-field versioned profile saves/conflict reload, website-only
  bounded history and historical fulfillment/quote detail remain memory-only.
- Added basket-sync.mjs and integrated checkout flow/view/storefront: automatic
  clean login load, differing device/account explicit choices, no merge, exact
  acknowledged-version debounce writes, in-flight edit retention and explicit
  409/uncertain reconciliation. Account baskets never use anonymous persistence;
  logout/identity removes account-origin baskets and storage events cannot leak
  a prior account basket into a later identity. Review flushes writes first.
- Defaults only prefill the first eligible delivery form and never overwrite
  touched per-order fields or implicitly save a profile. Background version
  refresh clears quote/review, not entered delivery text. Hidden/offline/logout/
  identity transitions clear private DOM/model and reject abort-ignoring replies.
- Owned account GET recovers the real historical checkout including PAID;
  no automatic POST, fabricated key or payment-link retry. PAYABLE joins bounded
  visible/online polling; focus/return rechecks identity and rearms ten checks.
  Ambiguous create keeps its exact original payload/key across BFCache for
  explicit retry only. Full reload cannot preserve that key. Known attempts
  discard private payload on pause and recover it with owned detail GET.
- Payment received is a server-verified state. Start new order explicitly drops
  only UI attempt context, ignores that dismissed recovery ID and leaves newer
  basket edits intact. Pending/uncertain attempts fence new orders; no automatic
  paid-cart cleanup was added or claimed. Original retained basket is explained.
- Extended api.mjs and vercel.json with four exact-host account rewrites and
  strict client methods, canonical page bounds, opaque IDs and real CSRF. Updated
  README/DEPLOYMENT for backend-first additive V52 and parent validation gates.
- Added tests/account.test.mjs, account-api.test.mjs, basket-sync.test.mjs,
  recovery.test.mjs; updated checkout/routing/storefront tests. Coverage authored
  for exact schemas/privacy, profile CAS, defaults non-overwrite, choices/debounce/
  races/409, hidden/offline/identity stale responses, flush, GET-only historical
  recovery, PAYABLE bounds, paid new-order/no basket clearing and startup gating.
- Read-only review corrections: initial dirty/unassociated deadlock, BFCache key
  loss, cleared unapplied defaults, stale prepared version, hidden auth POST race,
  URL/ID newline normalization and optional profile failure hiding payment state.
  Polling with drawer closed is intentional only for visible/online documents;
  no unconditional network timer loop. Each request keeps its 15-second bound.
- Editor diagnostics reported no errors in inspected sources, tests, HTML and
  routing. **No terminal commands, tests, builds, production/provider access,
  deployment or push were performed. No runtime passing claim.** Parent owns
  Node/syntax execution, real browser layout/accessibility/BFCache/privacy tests,
  Vercel cookie/CSRF/cache/routing execution and backend V52/regression validation.

## Two reviewed recovery / legacy-suggestion fixes — 2026-10-27

- Root causes: a definitive CHECKOUT_IN_PROGRESS left a fresh rejected idless
  snapshot blocking owned GET recovery; version-zero profile GET exposed raw
  shared-customer text that the frontend's strict profile validator rejected.
- CheckoutFlow now discards only a fresh, definitively rejected 409 snapshot and
  resumes owned GET recovery after releasing busy state. A failed recovery keeps
  preparation gated. An already ambiguous original retains its payload/key and
  explicit-retry availability even when a later retry receives that conflict.
- WebAccountService normalizes legacy layout separators to spaces and omits
  unsafe/short/overlength suggestions. No profile/shared-customer GET writes;
  saved defaults and strict PUT validation are unchanged.
- Regression tests: two prebootstrapped tabs recovering the actual ID by exact
  GET without resend; recovery failure gating; ambiguous same-key conflict retry;
  frontend profile/history bootstrap and editable suggestions; backend read-only
  GET/history/editability for multiline/control/overlength legacy data; isolated
  service coverage for overlength names/NUL beyond current database constraints.
- Re-validation: editor diagnostics report no errors in all six implementation
  and test files. No tests/builds/terminal/provider/parked/push operations performed;
  runtime validation remains with the parent. No lifecycle tools were called.

## Storefront product controls / historical attempt escalation — 2026-10-27

- Rehydrated the actual controller, checkout view/flow, basket synchronizer and
  existing tests. Execution extensions returned none. Website scope only; no
  lifecycle tools, backend, parked work, production/provider API, push or bundles.
- Added a test-only jsdom dependency and reproducible package manifest/lock; the
  fixture parses the actual breads.html and imports the actual storefront.mjs.
  Inline scripts/resources never execute; every API request is an in-memory
  allowlisted fake, and timers are controlled. Native top-layer dialog methods
  alone are shimmed, so this is DOM/bootstrap evidence, not browser layout proof.
- Before the secondary edit-gate fix, with receiver-insensitive arrow timer fakes:
  anonymous startup/reload and initially-hidden -> visible startup passed. All 20
  controls rendered on visible signed-in startup, with no exception in that fixture.
  PAID/CANCELLED/EXPIRED each failed `2 !== 3` on a real product + click; PAYABLE
  failed because its blocked click left the drawer closed. No async TDZ was
  established, and no bootstrap reorder/privacy guard change was made. These
  fixtures did NOT establish native-browser timer safety: their arrow fakes hid
  the receiver defect subsequently reproduced by the parent. Intentionally hidden
  startup deferral is separate from the visible-page missing-controls failure.
- PRIMARY root cause (parent's actual browser reproduction): assigning native
  setTimeout/clearTimeout as BasketSync instance callbacks changed their receiver.
  schedule -> this.cancel(this.timer) threw Illegal invocation on anonymous +,
  freezing the counter; setIdentity -> pause threw during signed-in startup before
  controls initialized. Parent fixed the defaults with globalThis arrow wrappers.
  This is not a TDZ or a user-cookie problem.
- SECONDARY root cause: checkout.canEdit used `!flow.state.attempt`, treating a
  historical verified terminal checkout as an active lock. Its refusal message
  was written only to status inside a closed drawer, appearing to do nothing.
- Fix: retain only the verified resolved attempt ID across private-data suspension
  to permit basket edits for PAID/CANCELLED/EXPIRED. Quantity edits still suspend
  and clear private results; identity changes clear the remembered permission.
  Attempt retention still fences prepare/confirm until explicit Start new order,
  which preserves the current basket. Unresolved/ambiguous attempts remain locked;
  blocked product/date edits open the recovery drawer and product clicks add an
  inline live status as fallback when another site modal prevents opening.
- Tests cover anonymous reload/persistence, initial hidden deferral/one startup,
  signed-in terminal recovery +/-, actual account PUT saves, explicit new-order
  gating/no checkout POST, PAYABLE/CREATING/UNKNOWN/REVIEW_REQUIRED visible blocks,
  modal fallback, hidden private-DOM clearing/no work, logout basket/privacy clear,
  synchronous identity notifications with differing baskets/no merge, and failed
  recovery retaining prepare/confirm guards. Expanded bootstrap suite: 13/13 pass.
- Files: storefront/storefront.mjs, checkout-flow.mjs, checkout-view.mjs,
  tests/bootstrap.test.mjs and this log; repository package.json/package-lock.json
  and .gitignore (node_modules excluded). Parent owns later bundling/deployment.
- Final frontend validation: **145/145 tests pass**, zero failures/skips/
  cancellations; all four changed module syntax checks and git diff --check pass.
  Editor diagnostics report no errors in the changed implementation/test modules
  or package manifest. No backend command or live browser/provider operation ran.

## Native-browser timer receiver regression follow-up — 2026-10-27

- Confirmed the parent's production default-timer wrappers are already present;
  left them and the earlier canEdit fix unchanged. Enriched the existing account
  execution reference before test edits. Atomic tests/docs scope; no scenario skill
  root or Execution/Breakdown Hints files supplied; Execution extensions: none.
- Added three regressions: default BasketSync anonymous change / identity pause /
  debounce reschedule/cancel; actual anonymous bootstrap +/- with persistence;
  actual signed-in bootstrap and debounced account PUT. Unit fakes explicitly reject
  BasketSync receivers; no delay/cancel injection bypasses the tested defaults.
- All bootstrap scenarios now use receiver-sensitive timer functions. Their
  non-strict entry point normalizes unbound calls to globalThis like browser timers,
  then strictly checks the receiver (including jsdom's own unbound storage timer).
  An initial overly strict fake rejected legitimate unbound calls; corrected the
  fixture, not production. Timer queues are cleared and global descriptors restored
  in finally; new bootstrap tests assert zero queued timers and restored globals.
- Final frontend self-check: **148/148 tests pass** (145 existing + 3 new), zero
  failures/skips/cancellations; **19 JS/MJS syntax checks pass**; git diff --check
  passes. Native-browser reproduction remains parent's evidence; this worker ran
  jsdom/actual module bootstrap only, with allowlisted in-memory fake APIs. No local
  browser-engine package was available and none was installed.
- Corrected the earlier root-cause statements above: timer binding is PRIMARY for
  both missing controls and frozen counters; historical terminal-order gating is
  SECONDARY. No production/browser/provider API, backend, parked work, server,
  deployment, push or bundle operation. Parent retains bundling ownership.

## Approved website-only checkout/drawer UX cleanup — 2026-10-27

- Verified clean baseline 166a54b and actual source firsthand. Research/done-when
  reference enriched in account-nextphase-task.md before source edits. Atomic
  integrated checkout/drawer correction; no scenario root, assessment, Execution
  stage or Breakdown Hints forwarded. Execution extensions returned none. No
  workflow lifecycle tools, backend or parked sources used.
- Terminal latest-account recovery is history-only, not an installed attempt.
  New current preparation needs no Start new order on login. Current accepted
  terminal payments retain a compact receipt until explicit Continue shopping,
  even across newer basket edits. Pending/UNKNOWN/REVIEW, immutable same-key retry,
  owned GET/session guards and support fences remain. No automatic basket clear.
- Removed historical delivery/quote from basket DOM; it stays internal for safe
  recovery and is explicitly viewable only via My account. Context-only actions,
  one signed-in quote source, customer-friendly stage wording and defaults retained.
  Quote/review keyed rendering preserves nodes during unchanged reads; background
  payment GETs keep status/link stable and don't show whole-panel checking states.
- Opening uses guarded double-rAF transform start, containment and deferred initial
  resume; startup/open timers cancel/coalesce. Resume promises are generation-safe.
  Focus/visible bursts coalesce without discarding prepared fields/review; ten
  five-second visible/online checks stop terminal. Privacy/close aborts clear DOM
  synchronously. Queued basket saves hold across transitions while existing PUT
  acknowledgements settle; delayed cart reads cannot replace contents mid-slide.
  Prior native timer receiver wrappers are unchanged.
- Focused read-only reviewer found two concrete edge cases: closing could strand
  saves, and newer edits could dismiss a current PAID receipt. Both fixed locally
  and covered by actual bootstrap regressions plus transition-hold unit coverage.
  No terminal agents ran; this worker exclusively executed local Node commands.
- Changed source: basket-sync, checkout-flow, checkout-view, storefront controller,
  native-dialog view and storefront CSS. Changed tests: basket-sync, bootstrap,
  checkout and recovery. Updated execution reference and deployment/progress docs.
- Validation pending final rerun below. jsdom is not evidence of native compositor
  frame smoothness, real top-layer focus trap, mobile layout or hosted transport.
  No extra dependencies, bundles, production/provider access, real OTP/order/payment,
  deployment or push. Existing backend/provider/flag configuration untouched.

### UX cleanup — final local validation

- **159/159 website tests pass**: all 148 existing tests retained, 11 added;
  0 failures, skips, cancellations or todos. Updated only genuine obsolete UX
  assertions; pending fences, immutable payloads, ownership/privacy and prior
  receiver-sensitive timer tests remain enforced. Actual bootstrap regressions
  cover historical terminal new baskets, field/review/quote node identity and
  focus/scroll, quiet/bounded/terminal polling, deferred/delayed animation work,
  Escape/rapid close, queued/in-flight saves and stale-identity resume coalescing.
- **19/19 JS/MJS syntax checks pass**, git diff --check passes; scoped editor
  diagnostics report **0 errors / 0 warnings**. No separate static-site build
  step exists. Only the website's 13 listed source/test/documentation files changed.
- Remaining manual acceptance: native-browser slide frame smoothness, real dialog
  focus trap/restoration/accessibility/mobile layout, actual tab/provider return
  and hosted cookie transport. No runtime or deployment claim beyond local fake-API
  jsdom/Node validation. No bundle generated.

## Fix2 P2 reviewer recovery corrections — 2026-10-27

- Root causes: account recovery filtered the browser-converted EXPIRED status as
  terminal history even when the validated server status was still PAYABLE; an
  initial null/defaults-ready shortcut then skipped all later visible recovery.
- Terminal history now uses the validated raw server status. Acceptance and owned
  GETs keep server-PAYABLE attempts pending even after local link expiry, with a
  null payment link, explicit expired-link guidance, basket/new-order fences and
  bounded status polling. Only verified server termination unlocks them. The view
  does not repeatedly schedule an already-expired, hidden-link deadline.
- Visible resumes now freshly GET account recovery; existing busy guards and view
  resume-promise coalescing prevent overlapping work. Unchanged null/history keeps
  exact prepared/review objects and messages, defaults apply only once, and quiet
  reads do not disable/blur delivery inputs. A newly pending result removes stale
  preparation/review. Owned and uncertain current attempts retain their existing
  GET-only/same-key recovery paths; routine focus does not reset poll bounds.
- Files changed by this correction: checkout-flow.mjs, checkout-view.mjs,
  tests/recovery.test.mjs, tests/bootstrap.test.mjs and this progress log. Existing
  parent changes preserved. Execution-extension lookup returned none applicable.
- Added six regressions: expired recovered/current attempts; unchanged null quote
  and review; coalesced null-to-UNKNOWN recovery; real-bootstrap null DOM/focus
  preservation; still-visible focus detecting another window's PAYABLE checkout.
  Existing PAID DOM test now also asserts fresh GET and enabled input while delayed.
  Updated only the obsolete historical-PAID single-read assertion to expect refresh.
- Validation: **165/165 tests pass** (all previous 159 plus six), zero failures,
  skips or cancellations; **19/19 JS/MJS syntax checks pass**; git diff --check
  passes. One initial new bootstrap assertion ran before released fake-network
  continuations finished; corrected the test settling, not production behavior.
- Website-only local Node/jsdom fake-API evidence. No backend, parked, production,
  provider, bundle, server, deployment or push operations. No user decision needed;
  native-browser/hosted acceptance remains manual as already documented above.

## Approved local-first shopping — 2026-10-27

- Read exact backend shopping-contract.md and current frontend source/tests;
  recorded research/scope in README before source edits. No scenario root, task
  path, assessment or Execution/Breakdown Hints supplied; no workflow invented.
  Execution extensions returned none. Atomic coupled shopping behavior verdict.
- Added shopping-model.mjs: strict snapshot/request validation, five-total/day
  allowance/product/whole-basket guards, deterministic lossless merge/date priority
  and integer-paise product estimates. Scoped prices retain active catalogue mapping.
- Changed storefront.mjs, view.mjs: bootstrap after CSRF, auth/date-only snapshot
  refresh (plus explicit refresh), personalized card prices/public restoration,
  local estimates/warnings, generic unavailable dates and live inline blocked +
  explanations. No quantity quote/session/shopping reads. Focus/drawer checks only
  session and independent payment recovery. Native timer receivers preserved.
- Changed basket-sync.mjs: once-per-identity initial merge including in-flight
  edits; no choices/truncation; retained overflow/retired reduction; 400ms quiet
  saves; bounded version-only conflict GET plus latest-local retry; retained-edit
  failure Retry; late acknowledgements cannot replace current local intent.
- Changed checkout-view.mjs and checkout-model.mjs: readiness + authoritative
  flush before prepare, prepared-only exact quote, RETAIL_LIMIT_EXCEEDED safe
  message and retry-only cart controls. CheckoutFlow/payment semantics untouched.
  Existing pending fences, bounded owned GET polls, exact ambiguous same-key retry,
  revocation, historical account separation and privacy regressions stay enforced.
- Added strict api.mjs POST route and one exact-host vercel.json rewrite. Updated
  tests/basket-sync, bootstrap, checkout, routing, storefront and new shopping tests.
  Meaningful existing cases retained; only approved changed-behavior assertions
  updated. README and DEPLOYMENT distinguish current rules from archived history.
- Review found startup hide/offline continuation, failed snapshot resurrection
  on focus and delayed auth price clearing; corrected all with regressions.
  Fresh Review now reuses authoritative sync state after server rejection without
  showing stale cart quotes. No production errors were hidden by test changes.
- Final local check: **308/308 tests pass** (165 baseline; includes nested strict
  security cases), **21/21 JS/MJS syntax checks pass**, git diff --check passes.
  Editor diagnostics report no errors/warnings. No static-site build script exists.
- Actual-module jsdom tests cover shopping/cart request counts, public/login/logout
  card prices, local estimates/final exact quote, one-slot/no-count feedback,
  date/product/whole-basket controls, merge-overflow/no-loss, in-flight load/edit,
  old save/snapshot callbacks, conflict version-only reads, retry and server
  rejection, startup/hidden/offline privacy and unchanged bounded payment recovery.
- Limits: advisory snapshot may change before server checkout; no full estimated
  payable. Native layout/animation/top-layer focus/BFCache and actual hosted
  Vercel/cookie/CSRF/payment-return integration remain unverified. Only this frontend
  repo edited. No backend/parked changes, network/provider/OTP/order operations,
  dependencies, bundles, push or deployment. No backend issue discovered requiring
  an implementation change.

## Fix3 P2 frontend reviewer corrections — 2026-10-27

- Root causes: explicit auth reused the background session epoch/coalesced GET;
  prepare CART_CONFLICT set a flow-only reload gate with no BasketSync retry;
  initial association deleted durable guest intent before any save acknowledgement.
- Explicit auth now increments the epoch, cancels the resume timer, aborts and
  invalidates session checks, and clears coalescing. Epoch plus generation/current
  guards reject old anonymous GETs even when fetch ignores abort. Fresh recovery
  can run without waiting for the old response, preserving authenticated pricing.
- Checkout conflicts notify BasketSync, which retains local lines/date and gates
  autosave until explicit Retry saving. One internal version-only GET and at most
  two PUTs retain latest local intent; repeated errors remain explicit. Local edits
  do not clear retry. Only successful flush clears the flow gate; the customer
  must Review again. No automatic prepare or checkout POST repeat.
- Added guest-intent.mjs: original anonymous ID/quantity storage survives merge,
  overflow, failed/interrupted saves and in-page logout/anonymous edits. Retirement
  and onAssociate occur once on a validated save acknowledgement (an empty guest
  association needs no write). A constant anonymous pending receipt is written
  before sending durable guest intent; it contains no account ID, PII, cart copy,
  date, token or server version. Blocked writes fail closed before PUT.
- On reload with an uncertainty fence, display the saved account basket WITHOUT
  adding retained guest quantities; retain the original key, explain uncertainty,
  and block saving/checkout until the customer explicitly checks/discards retained
  device additions or contacts support. Both committed and noncommitted lost-ack
  paths are tested. Noncommitted missing quantities need manual re-addition after
  explicit resolution; no version-based inference or account-scoped fingerprint.
- Overflow remains lossless page memory with an explicit unsaved/reload warning;
  only original guest intent is durable. A reload before any PUT reconstructs the
  original merge; page-only account edits/reductions are intentionally not stored.
- Files changed in this correction: storefront.mjs, basket-sync.mjs,
  checkout-flow.mjs, checkout-view.mjs, new guest-intent.mjs; tests/bootstrap,
  basket-sync, checkout and new guest-intent tests; README and this progress log.
  Existing unrelated working-tree changes were preserved. All edits used patches.
- Validation: **322/322 Node tests pass** (308 existing + 14 regressions), zero
  failures/skips/cancellations/todos; **23/23 JS/MJS syntax checks pass**;
  git diff --check passes; scoped VS Code diagnostics report no errors.
  Real-module jsdom tests exercise OTP/focus delayed abort-ignoring replies,
  conflict retry/fresh Review, 3+3 overflow/reload/ack retention, both lost-ack
  outcomes and logout protection; unit tests cover generation, receipt privacy/
  blocked storage/crash order, callback count and conflict fence behavior.
- Limits/decision: backend versions cannot identify a previous merge writer;
  without a backend intent receipt no automatic exactly-once guarantee across
  concurrent tabs/accounts/devices is claimed. The privacy-minimal global fence
  deliberately uses manual resolution rather than ambiguous automatic replay.
  Native browser/hosted cookie, transport and simultaneous-tab acceptance remain
  unverified. Website-only; sole terminal owner; no backend/parked/live API,
  provider, dependency, server, bundle, push or deployment operations.

## Final local validation — 2026-10-27

- Independent final frontend correction review and backend security/boundary
  review both PASS. Clean backend Maven run: 439 tests across 49 suites, zero
  failures/errors/skips. Frontend: 322 tests and 23 syntax checks pass.
- Native Chromium, local read-only server and mocked APIs only, 390×844:
  date allowance of one accepts the first addition and rejects the second with
  inline feedback while retaining an enabled plus button; switching to a suitable
  date permits five total and rejects the sixth with bulk-order feedback.
  Quantity clicks made no additional network requests. No browser errors or
  horizontal overflow. Integrated visibility was overridden for the fixture;
  the module was explicitly imported after enabling local configuration.
- No live OTP, account writes, order, payment or provider activity. Hosted
  personalized-login/payment acceptance and device motion remain user checks
  after deployment. Backend must be deployed before this website update.