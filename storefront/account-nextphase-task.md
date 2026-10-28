# Customer account next phase — execution reference

## Concise customer language and Indian phone input — research, 2026-10-27

- Verified scope: view/storefront, shopping-model estimate notice, checkout-view,
	checkout-flow, checkout-model problem messages, BasketSync, account controller
	and account access copy; static marketing stays untouched. Existing IDs/routes,
	payment fences, save/retry logic and validation must remain unchanged.
- Current phone submission trims then accepts optional + and 8–15 digits starting
	nonzero. Add a pure helper retaining that validation; only bare ten-digit inputs
	gain 91. Explicit + international inputs remain unchanged. Challenge body uses it.
- Remove empty disclaimer from aria-describedby; keep its DOM ID hidden for
	compatibility. Remove optional auth help rather than overwriting status text.
	Keep Estimated subtotal plus Final total shown before payment, and clear pending
	payment, availability/five-item/bulk, unsaved/reload-loss and recovery warnings.
- Atomic verdict: one bounded customer-language/input correction with regressions.
	No scenario skill root, assessment or Execution/Breakdown Hints forwarded.
	Skill lookup found none; Execution extensions returned none. No terminal/test
	commands permitted: editor diagnostics only; parent runs full Node 23+ suite,
	syntax/whitespace and browser checks after the backend worker finishes.
- Done when actual-module tests cover ten-digit challenge canonicalization and
	verification, preserved international/invalid formats, concise accessible copy,
	retained estimated qualification and no-double-payment warnings. Append progress.

## Approved website UX cleanup — verified research, 2026-10-27

- Baseline verified clean at 166a54b. Read actual storefront, checkout flow/view,
	BasketSync, native dialog/CSS, account validators and existing jsdom/fake tests.
	No backend, parked source, production/provider access, push or bundle work.
- Concrete causes: resume installs latest terminal historical order as an active
	attempt; render always replaces quote/delivery and clears them during every
	busy GET; opening starts quote immediately alongside startup's scheduled quote.
	BasketSync emits on read start/end even when its cart version is unchanged.
- Specific coherent change: separate historical terminal recovery from a current
	page's accepted attempt; compact payment recovery without historical PII;
	stage-only controls; keyed immutable quote/review rendering and quiet GET status
	checks; coalesced resume and animation-delayed opening refresh with cancellation.
	Preserve exact-key uncertain retry, session ownership, privacy and timer wrappers.
- Atomic decomposition verdict: one integrated checkout/drawer lifecycle correction
	with its UI regressions. No scenario root, assessment or Execution/Breakdown Hints
	files forwarded; Execution extensions report none. Skill discovery returned only
	the upgrade-specific runtime harness, not applicable to this non-upgrade task;
	explicit user-approved local Node/jsdom checks are the validation boundary.
- Done when historical terminal login/reload never shows past delivery or requires
	Start new order; current accepted terminal has compact receipt and explicit
	Continue without clearing basket; pending/uncertain fence and owned GET retained;
	unchanged busy/status/cart reads preserve quote/form nodes/focus/scroll; bounded
	visible-online checks stop terminal; synchronous privacy clearing; deferred open
	and close/Escape/reduced-motion timer safety; full existing suite plus regressions
	passes without new dependencies. Update this record/progress/deployment notes.

Scope is the website repository only. Authoritative backend contract read from
the backend account-contract document (2026-10-26); V52 must precede rollout.
Existing modules verified: checkout-flow owns immutable acceptance payloads and
LatestRequest cancellation, checkout-view owns private delivery DOM and bounded
polling, storefront owns anonymous storage and session lifecycle, api owns exact
routes and CSRF. Existing tests are dependency-free Node fake API/DOM tests.

Implementation concerns are independent account UI/model, exact API/routing,
and integrated checkout/basket lifecycle. Delegate the former two separately;
retain acceptance and basket coordination together to avoid competing ownership.
No scenario skill root, assessment, task path or breakdown hints were provided;
skill discovery returned no matching skill and Execution extensions returned none.
No workflow/task lifecycle tools, backend edits, parked sources, terminal commands,
builds, deployments or pushes are allowed. Parent owns execution validation.

Done when: standalone private account/profile/history UI; validated memory-only
defaults; choice-gated versioned automatic cart sync; bounded visible payment
checks and GET-only reload recovery; paid explicit new-order fence without basket
clearing; exact-host account routes; dependency-free regression tests and rollout
notes. Editor diagnostics may be used; tests must be reported as unrun here.

## Account UI subtask — verified research, 2026-10-27

- Atomic standalone account UI/model concern; no scenario root or Execution hints
	supplied. Parent already retrieved skills (no match) and extensions (none).
- Read backend account-contract, existing model/checkout-model, API, storefront,
	view, config, site navigation and dependency-free checkout tests before edits.
	Account files do not yet exist. Scope: account.html, account-model.mjs,
	account.mjs, account.css, account.test.mjs and one account link in each of the
	four normal primary navs. API/checkout modules and shared progress docs are owned
	by other workers and will not be edited.
- Reuse StorefrontApi.request/session/clearSession, exact gated account routes,
	existing quote and checkout validators. Preserve uncertain account states after
	expiry explicitly; independently reject Unicode separators in fulfillment.
- Profiles are exact five-field safe schemas. GET permits empty suggestions;
	PUT requires complete fulfillment and version below max safe integer. Save is
	explicit; conflict freezes further saves until explicit reload/discard choice.
- Read-only history has ten rows/page, opaque32 IDs and immutable historical
	snapshots, never reconstructed from the current catalogue/cart. No checkout POST,
	automatic retries, implicit profile saves or basket writes belong here.
- All private DOM and memory are destroyed synchronously on hidden/offline,
	pagehide/logout/cross-tab uncertainty; abort plus generations reject late work.
	Focus/visibility return reboots session before private reads. No PII persistence.
- Parent owns all execution validation. No commands, builds, tests, production,
	push or parked sources will be used. Subtask progress is appended here rather
	than modifying the shared progress document.

## Account UI subtask progress — implementation, unvalidated

- Added the standalone olive/cream account page, scoped responsive CSS, immutable
	account schemas, memory-only controller/view and dependency-free model/fake API/
	fake DOM regression tests. Added My account to breads/index/about/faq navs.
- Exact model exports: validateProfile(value, {saving=false}={}),
	profileInput(value), validateOrderDetail(value, expectedId?, now=Date.now()),
	validateHistory(value, expectedPage?). Controller exports AccountController and
	attachAccount for isolated tests. Detail returns id/orderNumber/createdAt/
	orderStatus/status/expiresAt/paymentUrl/fulfillment/quote (deep immutable).
- API integration required from peer: gated GET/PUT /api/account/profile;
	GET /api/account/orders?page=<0..10000>; GET /api/account/orders/<opaque32>;
	request(path, body, signal, method), useSession and clearSession retain their
	existing interfaces. PUT conflict detected by HTTP 409, not backend text.
- Explicit save only; conflict/uncertain save blocks resubmission until explicit
	reload. Existing DOM edits remain during conflict. Hidden/offline/pagehide/
	logout/cross-tab uncertainty erase values/private DOM/model and abort work;
	focus/visible/session checks precede further reads. Links revoke on expiry.
- No commands, tests, builds, diagnostics, browser/production access or pushes
	were run. Parent must execute tests, validate API integration, browser privacy,
	accessibility and responsive layout. No claim of passing validation is made.
- Deliberate UX limitation: sign-in link goes to Products with the auth anchor;
	existing basket must be opened there to sign in (no checkout/view module edit).
	No recovery POST, polling, basket mutation or profile persistence was added.

## Integrated implementation handoff

The main integration now recognizes the constant auth anchor and opens the
existing sign-in drawer, resolving the account subtask's original sign-in note.
The independent concerns were executed by bounded account UI and transport/test
workers, with acceptance/basket lifecycle kept under one owner. No scenario root
or hint files were available; no task-lifecycle state was fabricated.

Done-when implementation evidence: exact account model/API/routes, standalone
private profile/history/detail UI, one-time non-overwriting checkout suggestions,
choice-gated debounced CAS basket coordinator, independent request generations,
flush-before-review, owned historical GET recovery, visible/online bounded checks
including PAYABLE, explicit paid new-order context without basket clearing, and
pure/fake API/DOM regression suites. Backend OrderStatus enum was verified against
the actual source. Profile, cart, order keys/PII are never browser-persisted.

Review corrections include initial edit/recovery deadlock, BFCache ambiguous-key
retention, optional defaults failing independently of verified payment, stale
prepared quote after concurrent clean cart refresh, hidden auth continuation,
newline URL/ID normalization, and background refresh preserving entered fields.
Polling while the drawer is closed is deliberate: the document must be visible
and online, as requested; each return window is bounded to ten polls.

Validation is incomplete by instruction: editor diagnostics only, no commands,
test execution, builds, push, deployment or provider access. Parent must execute
Node tests, module syntax checks and isolated browser UX/security flows. Backend
V52 migration and backend tests must precede rollout. Actual paid-cart cleanup
is deferred; the retained basket is explained and never implicitly repurchased.

## Native timer receiver regression — verified research, 2026-10-27

- Parent reproduced native-browser Illegal invocation in BasketSync.schedule's
	this.cancel(this.timer), and in setIdentity -> pause during signed-in boot.
	Assigning bare native timers to instance properties changes their receiver.
	Parent already replaced default delay/cancel with globalThis arrow wrappers;
	production modules and the earlier terminal-attempt canEdit fix stay unchanged.
- Verified bootstrap tests import the actual storefront using jsdom's real DOM,
	but arrow-function timer fakes accept any receiver and masked this failure.
	Add receiver-checking regular timer functions, a default-constructor regression,
	and explicit anonymous-click/signed-in-boot tests with restored globals/queues.
- Atomic test/documentation correction; no scenario skill root, assessment or
	Execution/Breakdown Hints files supplied. Execution extensions returned none.
	Discovered runtime harness is not available here; use the explicitly requested
	Node suite, syntax and whitespace checks. No browser engine package is installed;
	jsdom bootstrap is not native-browser evidence. No new dependency is needed.
- Done when receiver-sensitive tests exercise default scheduling/cancellation,
	real anonymous +/- persistence and signed-in startup/account saves; globals are
	restored in finally and timer queues cleared; full frontend suite passes; notes
	name native timer binding PRIMARY and terminal-order edit gating SECONDARY.
	This dispatch permits frontend terminal validation only; no backend, production,
	browser/provider API, parked work, push or bundle operations.