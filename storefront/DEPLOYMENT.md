# Storefront deployment gates — checkout remains OFF

## T006 independent checkout gate (2026-10-26)

Final local validation: 381 backend tests / 64 frontend tests passed; scoped review
PASS. This is not hosted/provider acceptance. The prior live OTP/login/logout test
was user-confirmed; leave those working settings and the existing auth secret alone.

Transfer the regenerated app and website bundles together, review and push from
the other machine. Keep BAKERY_WEB_CHECKOUT_ENABLED=false and checkoutEnabled:false
during this first deployment. V48–V51 are additive and must all reach Railway;
V50/V51 also fence legacy WhatsApp link dispatch/revocation regardless of checkout
flag, so smoke-test existing WhatsApp ordering/payment-link reuse after deployment.
No new Razorpay account or webhook is required. Keep the existing signed live
webhook active. Website checkout charges the actual quoted amount: the WhatsApp
test-phone token-payment setting does NOT reduce a website payment to ₹1.

After confirming the deployed build, enable backend checkout first for authenticated
cart/prepare/status transport checks; frontend activation is a separate deliberate
config change/deployment. Then perform one consented low-value real payment with
the user, verify webhook-driven PAID, admin destination/order snapshot, receipt,
reload/support recovery and WhatsApp regression before broader public use.
Never test a real charge here automatically. A public frontend checkout flag is
not a tester allowlist: enabling it exposes checkout to every logged-in visitor.

Operational uncertainty: UNKNOWN/stranded CREATING claims must be reconciled
against Razorpay reference/link/payment records by support before release or any
replacement. There is no automatic claim reset or reconciliation dashboard in this
batch. Do not manually clear a fence merely because a browser timed out. Current
frontend recovery is in-memory; reload/logout loses its attempt handle. Use support
rather than submitting a replacement when an order/payment may already exist.

This implementation does not authorize launch. `checkoutEnabled: false` stays
checked in, independently from the existing exact-production-origin preview flag.
Keep `BAKERY_WEB_CHECKOUT_ENABLED=false` until the separately finalized backend
durable cart/prepare/accept/status work and operational/payment verification are
approved. No deployment, live API/provider call or real OTP was performed here.

Routing now includes `/api/cart`, `/api/checkout/prepare`, `/api/checkout` and
`/api/checkout/:opaqueId([A-Za-z0-9_-]{32})` to the SAME fixed Railway backend,
with the same exact www/apex host guards and private/no-store headers. There is no
general dynamic proxy. Backend enforces HTTP methods, ownership, feature flags,
Origin and CSRF. Preview deployments do not reach production via these rules.

Before a separately authorized rollout, validate mocked full flow, then hosted
proxy/secure-cookie/CSRF/cache/ownership and strict status-ID rewrite semantics;
the local source tests do not execute Vercel's routing engine. Backend must have
durable idempotency, shared capacity, verified Razorpay webhooks, cancellation/
expiry/late-payment reconciliation and configured payment availability. Only then
consider enabling both backend checkout and frontend checkout flags. Do not enable
OTP, make provider calls or launch payments merely to validate this code.

Customer flow is explicit Load or Save account basket → Prepare fresh quote →
Review immutable name/address/preferences → Confirm & Pay → secure payment link →
Refresh server-verified status. Preparing is not a reservation. Confirm creates a
real order awaiting payment. Neither redirects nor an opened link are proof of
payment. UNKNOWN/REVIEW require support; no replacement order/second link is
automatically requested. Cancellation/expiry hides payment URLs.

Credit balance greater than zero OR applied credit blocks online acceptance and
requires support. This includes positive balance with no credit applied; frontend
cannot infer balance from the quote. Credits are neither reserved nor consumed.
Zero-payable also requires support, never automatic PAID. PAYMENT_UNAVAILABLE has
no UPI/QR fallback. Confirm uses a private in-memory UUID and immutable payload;
network ambiguity offers only explicit SAME attempt recovery. Reload/logout loses
that memory: support must reconcile before the customer orders/pays again.

Checkout-only rollback: leave preview/login configuration intact, set frontend
`checkoutEnabled: false` and backend `BAKERY_WEB_CHECKOUT_ENABLED=false` through the
normal approved process. Reload open pages. Disabling checkout does not cancel
existing orders, revoke a provider link or reverse paid money; monitor/reconcile
existing attempts and webhooks. Never turn off settlement verification as a UI
rollback. No history/subscriptions/WhatsApp cutover is part of T006.

The older preview-only instructions below are historical operational context;
their “six paths/no checkout” descriptions apply to the preview baseline only.

## Historical live cart-preview + WhatsApp login test

User approval: 2026-10-26. Use the live website for this bounded test; no separate
staging environment is required by this decision. Nothing has been pushed or
deployed from the development machine. This is NOT checkout or payment launch.

## What is connected

- Browser UI enables only on `https://www.tranchebakery.in` and
  `https://tranchebakery.in`. Use the www address consistently for the login test;
  host-only cookies are separate if both hosts serve pages without redirecting.
- Vercel rewrites six exact paths to
  `https://tranchewa-app-production.up.railway.app`, preserving `/api`:
  GET `/api/catalog`, GET `/api/session`, POST `/api/quote`,
  POST `/api/auth/challenge`, POST `/api/auth/verify`, POST `/api/auth/logout`.
  HTTP method enforcement remains on the backend; no unsafe request is retried.
- Every rewrite has a host restriction. Vercel deployment/preview URLs do not proxy
  to production, even if someone manually enables the local UI config there.
- The browser never contacts the Railway hostname directly. Same-origin credentials
  carry Secure/HttpOnly/SameSite=Lax host-only cookies through the rewrite.
- Backend and Vercel responses explicitly prohibit API caching. Vercel external
  rewrite caching is disabled too. No authentication secret goes in the website.
- Existing WhatsApp ordering stays available. Basket is device-local; quoted money
  comes from the backend. No order, reservation, payment or subscription is created.

## 1. Configure Railway safely

In the existing application service's Variables page, add the settings below. Do
not modify existing database, WhatsApp, Razorpay or webhook variables.

| Variable | Value |
|---|---|
| `BAKERY_WEB_AUTH_SECRET` | A privately generated cryptographically random Base64 value containing at least 32 decoded bytes; no quotes |
| `BAKERY_WEB_ALLOWED_ORIGINS` | `https://www.tranchebakery.in,https://tranchebakery.in` |
| `BAKERY_WEB_COOKIE_SECURE` | `true` |
| `BAKERY_WEB_OTP_TEMPLATE` | `website_login_otp` |
| `BAKERY_WEB_OTP_LANGUAGE` | `en` |
| `BAKERY_WEB_ENABLED` | Start `false`; set `true` after the new backend is healthy |
| `BAKERY_WEB_OTP_ENABLED` | Start `false`; set `true` after routing/cookie/quote checks below |

The Authentication/Copy Code template must remain Active in Meta, in language en.
Existing Cloud API credentials are reused. Generate/store the new secret privately,
paste it only into Railway and keep it stable across deployments. Do not paste it,
OTPs, session cookies or raw session JSON into chat, screenshots, logs or bundles.
Setting web enabled without a valid secret intentionally prevents application
startup: configure the secret FIRST. No Vercel environment secret is needed.

## 2. Transfer and deploy both repositories

Use the latest regenerated root bundles, not an older copy:

- `tranche-changes.bundle.txt` into TrancheWA-App.
- `tranche-website.bundle.txt` into tranche-bakery.

On the other machine, unpack using the existing binary-safe unpack script, review
git diff/status, then commit and push BOTH repositories. Railway auto-deploys the
backend; Vercel deploys the static site. Keep the existing static/Other project
preset and repository root; no new install/build command or framework is required.
Root `vercel.json` must be included. No parked files, temp server or fake fixtures
are part of the bundles. Backend Flyway V46/V47 are additive and execute on deploy.

Wait for both deployments to report success. A transient unavailable preview while
the backend is off or deploying is expected; public WhatsApp ordering still works.
Report pushed confirmation so the development machine can sync and revalidate.

## 3. Turn on the API, check transport, then allow real OTP

Set `BAKERY_WEB_ENABLED=true`, leaving `BAKERY_WEB_OTP_ENABLED=false`, and let
Railway redeploy. Hard-refresh https://www.tranchebakery.in/breads.html.

Before requesting any code, check in browser DevTools Network/Application:

1. `/api/catalog` and `/api/session` return 200 JSON through the website hostname,
   not 404 HTML, redirects to Railway/admin, CORS failures or gateway errors.
2. The basket launcher and matching product quantity controls appear. Select a
   published delivery date and request a quote; `/api/quote` returns 200 with
   `X-XSRF-TOKEN` request header. No old total survives an edit/failure.
3. The browser/CSRF cookies are set for the website host, Path=/,
   Secure, HttpOnly, SameSite=Lax, with no Railway Domain attribute.
4. API responses are private/no-store, have no positive Age and are not CDN HITs.
   Set-Cookie must be forwarded intact, not cached/shared with another browser.
5. A Vercel preview/deployment URL has no launcher and `/api/session` does not
   return the production JSON. Existing nav/gallery/detail/WhatsApp links work.

If these fail, leave OTP sending off and fix routing/config rather than weakening
CSRF, Secure cookies or allowed origins. Never use wildcard origins.

Then set `BAKERY_WEB_OTP_ENABLED=true` and let Railway redeploy. The user performs
the real test with their own WhatsApp number: request one code, switch to WhatsApp,
return and enter it on the site, verify login, refresh the quote, reload to confirm
the session, log out, and confirm subsequent quotes are anonymous. Login/logout
replace CSRF tokens. Use a second tab/browser for session-isolation checks. Only
product IDs and quantities belong in local storage. Do not share the OTP here.

This writes real OTP/session/customer activity records and can create a customer
for a new number. It must not opt the customer into marketing or fake a WhatsApp
inbound-window event. Meta Authentication message fees may apply. Do not test with
another person's number without consent or repeatedly resend on a delivery error.

## Proxy/IP limits and monitoring

The application deliberately uses remoteAddr, not arbitrary client-supplied
forwarded-IP headers. Behind Railway/Vercel, proxy IPs may share OTP limits
(challenge IP bucket 20/15 minutes, plus per-phone/browser limits). This is a
conservative limitation for the low-volume live test, NOT proof of correct visitor
IP attribution. Investigate unexpected 429s; do not raise limits or enable blanket
forward-header trust to work around them. Confirm trusted proxy behaviour before
broader rollout. Origin allowlisting handles the website/backend host difference.

Observe status codes, aggregate failures and Meta delivery status without logging
phone numbers, OTPs, bodies, auth tokens or cookies. Actual hosted cookie, caching,
Origin and delivery behaviour cannot be proven by local fixture tests.

## Rollback

- Stop new OTP sends: `BAKERY_WEB_OTP_ENABLED=false`, redeploy Railway.
- Disable the entire new customer API immediately:
  `BAKERY_WEB_ENABLED=false`, redeploy Railway. Existing open UI requests then fail
  closed; quotes clear. WhatsApp/admin/payment webhook paths remain unaffected.
- Hide the UI as well: replace the config's enabled expression with `false`,
  deploy the website and reload. Assets are no-store. No database rollback is
  needed for the additive migrations. Existing login cookies/session records are
  not erased merely by disabling the feature; keep the secret stable.