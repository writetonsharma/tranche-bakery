# Storefront — basket preview and default-off T006 checkout

## T006 execution reference (2026-10-26, recorded before source edits)

Website-only working tree was clean. Read the replacement section of the backend
checkout contract, existing model/API/view/controller, tests, CSS and Vercel config.
The replacement durable-cart + prepare + acceptance + owned-status contract is
authoritative, not the historical 503 stub. No backend/parked files are changed.
No scenario skill root, assessment, task.md or breakdown hints were supplied; no
workflow files are invented. Execution extension lookup returned none. Recovered
runtime-validation guidance concerns an unavailable Modernizer runtime harness;
this task instead explicitly requires dependency-free Node/mock validation.

Scope is the specific frontend T006 feature: strict pure contract/attempt model,
owned-cart/checkout coordinator, isolated drawer UI, exact API/proxy allowlists,
and their tests/docs. These boundaries are implemented and validated in dependency
order, with tests first; no whole-application migration or lifecycle tools apply.
Preview and existing login remain unchanged when checkoutEnabled is not exactly
true. Only authenticated, explicitly selected account baskets can prepare/pay.
Quote tokens, immutable fulfillment and crypto-generated per-attempt keys stay in
memory. No silent cart overwrite/retry, redirect-as-paid, provider call or deployment.

Historical T004 notes below describe the preview baseline; the T006 section at the
end documents the added independently gated feature and supersedes checkout claims.

## T006 current behavior and rollout

- Independent `checkoutEnabled: false` is checked in. Preview `enabled` still uses
	only the two exact HTTPS production origins. Both must be strictly true to add
	checkout controls or permit durable-cart/checkout requests. No URL/storage switch.
- Optional login and anonymous preview remain available unchanged when checkout
	is off. Login alone never fetches/saves/merges the account basket. The two explicit
	choices say what they replace: Load discards the displayed edits; Save replaces
	the account basket, first reading its version if needed. Loading does not write
	account data into device storage. Device storage remains only item IDs/quantities.
- Edits require explicit Save before Prepare. PUT uses the known version, strict
	quantities and an exact India date within today..60 days. A 409 never retries or
	reloads automatically: Load is explicit consent to discard edits. GET can expose
	an older/unavailable date or null quote without pretending it is orderable.
- Prepare obtains a fresh version-bound server quote/token; money is never computed
	locally. Enter name, single-line full delivery address and both preferences, then
	Review freezes that snapshot for display. Only **Confirm & Pay** submits it with
	the accepted quote token and an in-memory `crypto.randomUUID()` key. This creates
	a real delivery-only retail order awaiting Razorpay payment, not a preview or
	an immediate paid order. Address is an order snapshot, not a profile update.
- No automatic POST/PUT retry. Lost/invalid/5xx acceptance responses retain the
	identical immutable payload/key. The explicit SAME attempt action recovers by
	retransmitting exactly those fields, even if the quote expired/cart changed.
	If an owned ID is known, recovery uses only its status GET, never acceptance.
	A recovered link always shows the original immutable checkout quote and delivery
	snapshot, explicitly distinct from any basket edits made after submission.
	No keys, tokens, phone, name, address or session data are persisted. A reload or
	identity change loses recovery memory: contact support, do not assume no order.
- CREATING/UNKNOWN can poll at five-second intervals, at most ten GETs per page
	flow, only while visible, online and the drawer is open. Manual Refresh verified
	status remains available. UNKNOWN (including past deadline) and REVIEW_REQUIRED
	need support; cancellation/expiry suppress links. PAID comes solely from the
	owned server status. Opening/returning from Razorpay never marks anything paid.
- Links require literal HTTPS on exact rzp.io or razorpay.com, a nonempty simple
	provider path, no query, credentials, explicit ports, fragments or encoded path
	tricks. They open in a separate no-referrer/noopener tab. A stricter path grammar
	intentionally fails closed if a future provider URL format changes.
- Any credit balance OR applied credit requires support, including a quote with
	zero applied credit but a positive account balance. The backend enforces the
	latter (the cart DTO does not disclose balance). Credits are not reserved or
	consumed online. Zero-payable is support-only, never fake paid. Payment gateway
	unavailable means no QR fallback. Capacity/quote changes need a fresh review.
- Cart/date changes, close/cancel, offline, visibility changes, identity/cross-tab
	uncertainty clear quote/review/link immediately and invalidate pending work.
	Same-identity pause/offline retains only a private attempt for explicit recovery;
	logout/cross-tab identity invalidation destroys it. Session is rechecked before
	every checkout operation. Only allowlisted problem codes become fixed local
	messages; backend error text is never rendered/logged. No history/subscription
	or WhatsApp ordering cutover is included.

### T006 checks and mock selectors

Run `node --test storefront/tests/*.test.mjs`, syntax-check every storefront JS/MJS,
and `git diff --check`. The suite uses fake fetch/session data, adversarial DTOs,
abort-ignoring races and a dependency-free mock DOM. It covers the real UI click
sequence Load → Prepare → Review → Confirm & Pay → open-link/status controls,
fixed fulfillment despite hidden-field mutation, and immediate private-state clear.
It never calls production, OTP or a payment provider. Browser layout/focus and
actual Vercel rewrite execution are **not** proven by this mock DOM.

For an isolated browser harness inject `{enabled:true, checkoutEnabled:true}` before
scripts, intercept ALL `/api/**` with fixtures and deny outbound network. Selectors:
`#sf-checkout`, `#sf-checkout-status`, `#sf-cart-load`, `#sf-cart-save`, `#sf-prepare`,
`#sf-checkout-quote`, `#sf-delivery`, `#sf-delivery-name`, `#sf-delivery-address`,
`#sf-delivery-preference`, `#sf-loaf-preference`, `#sf-review`, `#sf-accepted-details`,
`#sf-confirm-pay`, `#sf-payment-link`, `#sf-checkout-refresh`, `#sf-checkout-retry`,
`#sf-checkout-abort`. Existing preview/gallery selectors remain unchanged.

T006 adds four host-guarded proxy rules (three literal routes and one exactly
32-base64url-character status ID) to the existing six. Backend ownership/method/
Origin/CSRF checks remain authoritative; the rules are not a general API proxy.
See the T006 gate in the deployment guide. No push/deploy/bundle was performed.

## Current deployment decision (2026-10-26)

The user explicitly approved testing preview + WhatsApp login on the live website
instead of creating a separate staging environment. Production connection code is
prepared but not deployed here. Follow `DEPLOYMENT.md` in this directory for the
exact Railway variables, deployment order, hosted checks and rollback.

## Verified execution reference (2026-10-26, before implementation)

Read the current backend storefront spec, constitution, architecture and plan, plus
`StorefrontDtos.java`, `AuthController.java`, `OtpService` contract and current
`menu.json`. No parked implementation or repo memory was read. The working tree
was clean. Only this website repository is in scope.

The 20 current `.product .text > h3` headings exactly match current backend menu
names after HTML entity decoding. An explicit identity-name allowlist will pin
these mappings, not IDs or prices. Runtime catalogue IDs are authoritative. The
additional backend millet loaf has no public card and must not be surfaced.
Duplicate IDs/names/headings and missing/unknown/retired mappings fail closed.

Contracts: GET `/api/catalog` returns `items`, `offers`, `deliveryDates`. GET
`/api/session` and POST `/api/auth/verify`, `/api/auth/logout` return
`authenticated,customer,csrfHeaderName,csrfToken`. POST challenge accepts `{phone}`
and returns `{challengeId,expiresInSeconds,message}`; POST verify accepts
`{challengeId,code}`. POST quote accepts only `{lines:[{itemId,quantity}],date?}`.
Quote totals and date come exclusively from the server. CSRF replacement after
verify/logout must replace the in-memory bootstrap token. Cookies are HttpOnly.

Implementation is one bounded frontend enhancement with separate model, request,
view and controller modules and dependency-free Node tests. No backend, checkout,
history, payment, saved server cart or deployment changes. Existing inline scripts
own navigation/detail-modal state; the native modal drawer will not modify their
classes, styles or history. Refuse drawer opening while either existing UI is open.

Decomposition: atomic T004, with browser validation/security review delegated to
the parent as requested. No scenario skill root, Execution-stage/hint files,
existing task.md path or task-related skills were forwarded. Instruction lookup
found no matching implementation skill and no applicable Execution extensions.
This document records research in lieu of editing a task file outside the allowed
repository. Rollout and validation instructions follow with the implementation.

## Rollout / integration

- The checked-in `config.js` enables the preview on the exact HTTPS origins
	`https://www.tranchebakery.in` and `https://tranchebakery.in` only. Other origins,
	including local and Vercel preview URLs, stay disabled. When disabled, there are
	no `/api` requests, storage reads, new listeners, controls or drawer. Existing
	public scripts/content/images/prices/WhatsApp links remain untouched.
- Load `breads.html` normally; its only integration change is the isolated stylesheet,
	config script and module entry. No package manifest, dependencies or build step.
	Modern native-dialog browsers are required; unsupported browsers retain the public
	workflow. Serve modules with a JavaScript MIME type; ES modules do not work from
	`file:` URLs. The parent owns browser-server setup, not this implementation.
- For a local mocked browser test, inject
	`window.TRANCHE_STOREFRONT = { enabled: true }` using Playwright `addInitScript`
	**before navigation**. Intercept same-origin `/api/**` requests; never proxy local
	or preview tests to production. No query-string, storage flag or API host setting
	exists. The config preserves an explicitly injected object.
- Root `vercel.json` proxies exactly six customer endpoints to the existing Railway
	backend, preserving their `/api` paths. Every rewrite requires a live bakery host;
	preview hosts have no production rewrite. No wildcard/admin/webhook/payment proxy,
	second API base URL, serverless commerce backend or frontend secret is introduced.
	API browser/CDN caching and Vercel external-rewrite caching are explicitly disabled.
	Storefront assets use no-store for predictable activation/rollback on reload.
- Validate HTTPS, HttpOnly/Secure/SameSite cookies, backend exact-origin/CSRF rules,
	proxy host/scheme/IP trust, no redirect-to-admin and private/no-store CDN behaviour.
	All fetches use same-origin credentials, no-store, redirect rejection and a 15s
	timeout. Never automatically replay unsafe requests after failure.
- CSRF is bootstrapped from `/api/session`, echoed as `X-XSRF-TOKEN`, and replaced
	from successful verify/logout responses. The browser never reads session cookies.
	Challenge/token/customer/phone/code remain ephemeral; the only storage key is
	`tranche.preview.lines.v1`, containing an array of `{itemId,quantity}` only.
- Catalogue IDs come from the live response. Exact public-name mappings are pinned
	in `model.mjs`; missing/retired/unknown/duplicate headings have no controls.
	Ambiguous catalogue IDs/names fail the whole enhancement closed. Do not fuzzy-match
	aliases or use the legacy public `PRODUCTS` object for quote identity or money.
	Update the mapping and tests deliberately if a public product name changes.
- Quote requests contain only lines and optional selected date. Server amounts and
	dates are rendered verbatim. The backend controls date eligibility, promotions,
	credit and availability; catalogue dates alone promise nothing. No checkout exists.
	Successful quotes are still previews, reserve nothing and expire locally in 60s.
	Cart/date edits, identity uncertainty, offline/hidden/closed state immediately clear
	old totals and invalidate pending work; older responses cannot restore them.
- WhatsApp login is optional. Local resend delay is 60s (including uncertain failed
	sends); the server remains authoritative for all throttling and attempt limits.
	Code expiry uses the response duration, conservatively measured before sending.
	Busy state prevents duplicate submissions; rejected codes require a new challenge.
	Phone/code inputs are cleared on close/logout/session changes. Switching to WhatsApp
	to read a code preserves the in-memory challenge; returning rechecks session before
	quoting. Cross-tab identity notifications contain only a constant event name.
- Roll back by restoring `enabled: false`; reload open pages. Do not claim this clears
	an existing HttpOnly login cookie. No checkout, reservation, server-saved basket,
	history, subscription or payment functionality is implemented by this task.

## Automated checks

From the website repository, run
`node --test storefront/tests/storefront.test.mjs storefront/tests/routing.test.mjs`
and `node --check` on each `.js`/`.mjs` in this directory. Node 20+ is needed for the
test suite (`toSorted`); validation used Node 24.21.0. Tests use only fake fetches,
in-memory storage and source checks: they do not call the backend or send OTPs.

## Parent browser validation / mock suggestions

Stable selectors: `#sf-open`, `#sf-drawer`, `#sf-close`, `#sf-items`, `#sf-date`,
`#sf-totals[data-current="true"]`, `#sf-status`, `#sf-refresh`, `#sf-auth-status`,
`#sf-identity`, `#sf-login`, `#sf-phone`, `#sf-send`, `#sf-code`, `#sf-verify`,
`#sf-expiry`, `#sf-logout`. Card controls: `.sf-card-action[data-sf-item="ID"]`;
drawer rows: `#sf-items .sf-line[data-sf-item="ID"]`. Prefer accessible roles/names
(`Add one NAME`, `Remove one NAME`, `Open basket preview, N items`) over child order.

1. **Nonproduction/no takeover:** on local or preview origins without injection,
	 assert zero `/api/**` calls and no `#sf-open`/`#sf-drawer`. On the exact live HTTPS
	 origins the preview is enabled, provided the backend bootstrap succeeds.
	 Check every existing card/gallery/detail button, public
	 offer, image, WhatsApp URL, responsive nav and detail modal still work.
2. **Catalogue fixture:** supply all 20 pinned names with arbitrary nonsequential
	 numeric IDs, server dates and DTO-compliant prices. Verify controls send exactly
	 those IDs. Remove a catalogue item; duplicate a name/ID/heading; supply unknown
	 names. No unrecognised/retired product should gain an orderable control. Full
	 catalogue ambiguity must leave the existing page usable with an honest note.
3. **Drawer accessibility:** keyboard open, initial close-button focus, Tab and
	 Shift+Tab cycle, background non-interactivity, Escape and backdrop close, focus
	 restore, reduced motion, 320px viewport, 200–400% zoom and long item names. Check
	 scroll stays in the panel and the page unlocks without touching existing nav/modal
	 body classes/history. Drawer launcher is hidden/refuses open while either is open.
4. **Quantities/storage:** add/remove in card and drawer; controls stay synchronised,
	 no focused row is replaced on ordinary updates. At zero a removed drawer row moves
	 focus to Refresh. Test qty99, 40-line model bound, reload, corrupt/oversized/private
	 storage and cross-tab quantity changes. Inspect storage: IDs/quantities only.
5. **Quote races:** hold quote A, change quantity/date and resolve quote B before A
	 (including an abort-ignoring mock). A must never restore totals. Delay the session
	 bootstrap too. Edit during requests, close drawer, hide page, go offline and advance
	 clock 60s. Confirm no stale/current badge or old amount remains. Reconnect is not
	 a success claim; Refresh must get fresh session and server quote. Use a server
	 total deliberately inconsistent with client arithmetic to detect recalculation.
6. **Auth fixture:** anonymous `/api/session` returns token A; challenge returns a
	 dummy challenge ID, 300s and generic message. Verify returns authenticated customer
	 projection plus token B; logout returns anonymous plus token C. Assert exact POST
	 bodies, A/B/C token replacement, same-origin cookies and no duplicate requests on
	 double-click/Enter. No actual Meta/provider request is permitted. Test six-digit
	 validation, expiry, resend cooldown, busy disabling and a lost verification/logout
	 response. Failure must never leave old personalised totals or claim success.
7. **Identity transitions:** login/logout while quote is pending, external tab event,
	 cookie/session expiry and browser back-forward restoration. Switch to WhatsApp and
	 back during a live challenge: code entry must remain possible. Close during auth:
	 any later response must not repopulate the challenge/session UI with stale state.
8. **Failure/security mocks:** 400/401/403/404/429/503, malformed JSON/DTO, redirect,
	 failed DNS/network and 15s timeout. Insert HTML/script strings in catalogue labels,
	 quote names/labels/problems: they must be inert text, never parsed markup. No error
	 body, OTP, phone or token should appear in logs, URLs, storage or notifications.
	 Confirm `#sf-totals` is cleared for failures and there are no checkout/payment or
	 saved-history controls. All money is explicitly a non-reserving server preview.

Local parent browser checks have now covered default-disabled behaviour, 20 mapped
cards, quantity persistence, fake OTP login/logout and rotating CSRF, server quotes,
logout/offline stale-total clearing, keyboard focus/Tab/Escape/backdrop, reduced
motion and 1440/390/320px layouts. Follow-up source review found no concrete local
blockers. See progress-details.md for the checkpoint. These mocked checks are not
proof of hosted proxy integration, real delivery or full assistive-technology
accessibility; those remain post-deployment live-test gates. The earlier
disabled-by-default/staging-only implementation reference above is historical;
the explicit production-origin configuration and deployment guide supersede it.