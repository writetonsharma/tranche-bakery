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