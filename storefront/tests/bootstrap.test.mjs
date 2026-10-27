import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { PRODUCT_NAMES, STORAGE_KEY } from '../model.mjs';
import { GUEST_RECEIPT_KEY } from '../guest-intent.mjs';

const html = await readFile(new URL('../../breads.html', import.meta.url), 'utf8');
const id = 'b'.repeat(32);
const date = '2026-11-03';
const details = { name: 'Fixture customer', address: '123 Fixture Street, Gurugram',
  deliveryPreference: 'GATE', loafPreference: 'WHOLE' };
const quoteFor = (lines, deliveryDate = date) => ({ valid: true, date: deliveryDate,
  lines: lines.map(line => ({ ...line, name: PRODUCT_NAMES[line.itemId - 1], unitPrice: 20, lineTotal: line.quantity * 20 })),
  problems: [], itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
  listSubtotal: 40, discountAmount: 0, discountLabel: null, batchDiscountAmount: 0,
  batchDiscountLabel: null, giftLabel: null, deliveryCharge: 0, creditApplied: 0, totalAmount: 40 });
const historical = status => ({ id, orderNumber: 'WEB-FIXTURE', createdAt: '2026-10-26T08:00:00Z',
  orderStatus: 'CONFIRMED', status, expiresAt: '2099-11-03T08:00:00Z',
  paymentUrl: status === 'PAYABLE' ? 'https://rzp.io/i/fixture' : null,
  fulfillment: details, quote: quoteFor([{ itemId: 1, quantity: 2 }]) });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
let serial = 0;
// Browser timers normalize an unbound call to the global receiver, but reject
// unrelated objects. A non-strict entry point models that Web IDL behavior even
// though this test and the storefront are strict ES modules.
const browserTimer = implementation => Function('implementation',
  'return function (...args) { return implementation.call(this, ...args); };')(implementation);

async function fixture({ authenticated = false, status = null, hidden = false, storageLines = [],
  accountLines = [{ itemId: 1, quantity: 2 }], recoveryFails = false, reducedMotion = true,
  shoppingDates, shoppingHook, guestReceipt = false, initialHook = async () => {} } = {}) {
  const errors = [], calls = [], timers = new Map(), intervals = new Map(), timerCalls = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  // No scripts/resources run in jsdom: all network is the exact fake API below.
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/breads.html', virtualConsole });
  const { window } = dom, { document } = window;
  let visible = !hidden, online = true, loggedIn = authenticated, timerId = 0;
  let requestHook = initialHook;
  let cart = { version: 1, lines: structuredClone(accountLines), date, quote: quoteFor(accountLines), problems: [] };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  // The page's inline public-price renderer runs before its module in browsers.
  // jsdom runs no scripts, so provide that renderer's existing DOM shape only.
  for (const heading of document.querySelectorAll('.product .text > h3')) {
    const group = document.createElement('div'); group.className = 'product-price-group';
    const amount = document.createElement('span'); amount.className = 'price-now'; amount.textContent = '₹20 public';
    group.append(amount); heading.after(group);
  }
  window.TRANCHE_STOREFRONT = { enabled: true, checkoutEnabled: true };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storageLines));
  if (guestReceipt) window.localStorage.setItem(GUEST_RECEIPT_KEY, 'pending');
  // jsdom provides the real DOM/event tree but not native top-layer dialog methods.
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const session = () => ({ authenticated: loggedIn, customer: loggedIn ? { id: 7 } : null,
    csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: 'fixture-csrf' });
  const fetcher = async (path, options) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    calls.push({ path, method: options.method, body, signal: options.signal });
    const intercepted = await requestHook(path, options);
    if (intercepted) return intercepted;
    let value;
    if (path === '/api/catalog') value = { items: PRODUCT_NAMES.map((name, i) => ({ id: i + 1, name })), deliveryDates: [date] };
    else if (path === '/api/session') value = session();
    else if (path === '/api/auth/challenge') value = { challengeId: 'fixture-challenge', expiresInSeconds: 300 };
    else if (path === '/api/auth/verify') { loggedIn = true; value = session(); }
    else if (path === '/api/auth/logout') { loggedIn = false; value = session(); }
    else if (path === '/api/shopping') {
      const dates = shoppingDates || Array.from({ length: 7 }, (_, i) => ({
        date: new Date(Date.parse(date) + i * 86400000).toISOString().slice(0, 10),
        maxItems: 5, itemIds: PRODUCT_NAMES.map((_, i) => i + 1)
      }));
      const eligible = body.date ? dates.find(day => day.date === body.date)?.itemIds || [] : PRODUCT_NAMES.map((_, i) => i + 1);
      value = { retailLimit: 5, date: body.date || null, pricingMode: 'SINGLE_ITEM_ESTIMATE', dates,
        items: PRODUCT_NAMES.map((name, i) => ({ id: i + 1, name, category: 'Breads', description: null,
          weightLabel: null, listPrice: 20, unitPrice: loggedIn ? 15 : 20,
          priceLabel: loggedIn ? 'Fixture special rate' : null, singleItemBatchDiscount: body.date ? 0 : null
        })).filter(item => eligible.includes(item.id)) };
      if (shoppingHook) value = await shoppingHook(value, { body, loggedIn });
    }
    else if (path === '/api/account/checkout') {
      if (recoveryFails) throw new TypeError('Fixture recovery offline');
      value = { checkout: status ? historical(status) : null };
    } else if (path === `/api/account/orders/${id}` || path === `/api/checkout/${id}`) value = historical(status);
    else if (path === '/api/checkout/prepare') value = { cartVersion: cart.version, quote: cart.quote,
      quoteToken: 't'.repeat(43), expiresAt: new Date(Date.now() + 600000).toISOString() };
    else if (path === '/api/checkout') { status = 'PAYABLE'; value = historical(status); }
    else if (path === '/api/account/profile') value = { version: 1, ...details };
    else if (path === '/api/cart') {
      if (options.method === 'PUT') cart = { ...body, version: body.version + 1, quote: quoteFor(body.lines, body.date), problems: [] };
      value = cart;
    } else if (path === '/api/quote') value = quoteFor(body.lines, body.date || null);
    else {
      const error = new Error(`Unexpected API operation: ${options.method} ${path}`);
      errors.push(error); throw error;
    }
    return { ok: true, json: async () => structuredClone(value) };
  };
  const replacements = { window, document, navigator: window.navigator, HTMLDialogElement: window.HTMLDialogElement,
    Event: window.Event, fetch: fetcher, BroadcastChannel: class { postMessage() {} },
    requestAnimationFrame: callback => callback(), matchMedia: () => ({ matches: reducedMotion }),
    // Arrow fakes hide the native-browser Illegal invocation when timers are
    // stored on BasketSync and invoked with that instance as their receiver.
    setTimeout: browserTimer(function (callback, ms) {
      assert.equal(this, globalThis, 'setTimeout must retain the browser global receiver');
      timerCalls.push({ method: 'setTimeout', ms });
      const key = ++timerId; timers.set(key, { callback, ms }); return key;
    }),
    clearTimeout: browserTimer(function (key) {
      assert.equal(this, globalThis, 'clearTimeout must retain the browser global receiver');
      timerCalls.push({ method: 'clearTimeout', key }); return timers.delete(key);
    }),
    setInterval: browserTimer(function (callback) {
      assert.equal(this, globalThis, 'setInterval must retain the browser global receiver');
      const key = ++timerId; intervals.set(key, callback); return key;
    }),
    clearInterval: browserTimer(function (key) {
      assert.equal(this, globalThis, 'clearInterval must retain the browser global receiver');
      return intervals.delete(key);
    }) };
  const saved = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const f = {
    window, document, calls, errors, timerCalls,
    get pendingTimers() { return timers.size + intervals.size; },
    node: selector => document.querySelector(selector),
    setStatus(value) { status = value; },
    intercept(callback) { requestHook = callback; },
    scheduled(ms) { return [...timers.values()].filter(timer => timer.ms === ms).length; },
    get cart() { return cart; },
    setCart(value) { cart = structuredClone(value); },
    async tick(ms) {
      const ready = [...timers].filter(([, timer]) => timer.ms === ms);
      for (const [key, timer] of ready) if (timers.delete(key)) timer.callback();
      await settle();
    },
    async visibility(value) { visible = value; document.dispatchEvent(new window.Event('visibilitychange')); await settle(); },
    async offline() { online = false; window.dispatchEvent(new window.Event('offline')); await settle(); },
    async online() { online = true; window.dispatchEvent(new window.Event('online')); await settle(); await f.tick(200); },
    async loginElsewhere() { loggedIn = true; window.dispatchEvent(new window.Event('focus')); await settle(); await f.tick(200); },
    async logoutElsewhere() { loggedIn = false; window.dispatchEvent(new window.Event('focus')); await settle(); await f.tick(200); },
    cleanup() {
      timers.clear(); intervals.clear(); window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    }
  };
  try {
    await import(`../storefront.mjs?bootstrap=${++serial}`);
    await settle();
    return f;
  } catch (error) { f.cleanup(); throw error; }
}

function assertStarted(f) {
  assert.equal(f.node('.sf-start-error'), null, 'real storefront startup must complete');
  assert.equal(f.document.querySelectorAll('.sf-card-action').length, 20);
  assert.deepEqual(f.errors, []);
}
const quantity = f => f.node('.sf-card-action .sf-quantity span').textContent;
const plus = f => f.node('.sf-card-action .sf-quantity button:last-child');
const minus = f => f.node('.sf-card-action .sf-quantity button:first-child');

for (const authenticated of [false, true]) {
  test(`receiver-sensitive default timers: real ${authenticated ? 'signed-in boot and save' : 'anonymous boot and +/-'}; globals restored`, async () => {
    const keys = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
    const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    const f = await fixture({ authenticated });
    try {
      assertStarted(f);
      if (authenticated) {
        // identity -> pause cancels even an undefined timer before controls exist.
        assert.ok(f.timerCalls.some(call => call.method === 'clearTimeout' && call.key === undefined));
        await f.tick(200); assertStarted(f);
      }
      const initial = authenticated ? 2 : 0;
      plus(f).click(); assert.equal(quantity(f), String(initial + 1));
      minus(f).click(); assert.equal(quantity(f), String(initial));
      plus(f).click(); assert.equal(quantity(f), String(initial + 1));
      if (authenticated) {
        assert.ok(f.timerCalls.some(call => call.method === 'setTimeout' && call.ms === 400));
        await f.tick(400);
        assert.equal(f.cart.lines[0].quantity, 3);
        assert.equal(f.window.localStorage.getItem(STORAGE_KEY), null);
      } else {
        assert.deepEqual(JSON.parse(f.window.localStorage.getItem(STORAGE_KEY)), [{ itemId: 1, quantity: 1 }]);
        assert.equal(f.calls.some(call => call.path.startsWith('/api/account/')), false);
      }
      assert.deepEqual(f.errors, []);
    } finally { f.cleanup(); }
    assert.equal(f.pendingTimers, 0, 'cleanup removes every queued timeout and interval');
    keys.forEach((key, index) => assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), saved[index]));
  });
}

test('real anonymous module startup and reload render controls and persist working +/-', async () => {
  let f = await fixture();
  let stored;
  try {
    assertStarted(f);
    plus(f).click(); plus(f).click(); minus(f).click();
    assert.equal(quantity(f), '1');
    stored = JSON.parse(f.window.localStorage.getItem(STORAGE_KEY));
    assert.deepEqual(stored, [{ itemId: 1, quantity: 1 }]);
    assert.equal(f.calls.some(call => call.path.startsWith('/api/account/')), false);
  } finally { f.cleanup(); }
  f = await fixture({ storageLines: stored });
  try { assertStarted(f); assert.equal(quantity(f), '1'); minus(f).click(); assert.equal(quantity(f), '0'); }
  finally { f.cleanup(); }
});

test('initially hidden actual module defers all enhancement until visible, then initializes once', async () => {
  const f = await fixture({ hidden: true, authenticated: true, status: 'PAID' });
  try {
    assert.equal(f.calls.length, 0);
    assert.equal(f.document.querySelectorAll('.sf-card-action').length, 0);
    await f.visibility(true); assertStarted(f); await f.tick(200);
    await f.visibility(false); await f.visibility(true); await f.tick(200);
    assertStarted(f);
    assert.equal(f.calls.filter(call => call.path === '/api/catalog').length, 1);
  } finally { f.cleanup(); }
});

for (const status of ['PAID', 'CANCELLED', 'EXPIRED']) {
  test(`real signed-in refresh with historical ${status}: clean current basket without historical checkout fence`, async () => {
    const f = await fixture({ authenticated: true, status });
    try {
      assertStarted(f); await f.tick(200); assertStarted(f);
      assert.equal(quantity(f), '2');
      assert.equal(f.node('#sf-drawer').open, false);
      assert.equal(f.node('#sf-checkout-quote').children.length, 0, 'closed drawer does not expose private order');
      assert.equal(f.node('#sf-payment-link').hasAttribute('href'), false);
      plus(f).click(); assert.equal(quantity(f), '3');
      await f.tick(400);
      assert.equal(f.cart.lines[0].quantity, 3, 'resolved order does not prevent automatic account basket saves');
      await f.tick(200);
      minus(f).click(); assert.equal(quantity(f), '2');
      await f.tick(400); await f.tick(200);
      assert.equal(f.cart.lines[0].quantity, 2);
      assert.equal(f.window.localStorage.getItem(STORAGE_KEY), null, 'account basket never persisted anonymously');
      f.node('#sf-open').click(); await settle();
      assert.equal(f.node('#sf-new-order').hidden, true, 'historical terminal orders never need Continue');
      assert.equal(f.node('#sf-prepare').disabled, false);
      assert.equal(f.node('#sf-accepted-details').children.length, 0);
      assert.doesNotMatch(f.node('.sf-checkout').textContent, /Original checkout delivery|Delivery snapshot|WEB-FIXTURE|Fixture customer/);
      assert.equal(f.node('#sf-cart-load').hidden, true);
      assert.equal(f.node('#sf-cart-save').hidden, true);
      assert.equal(f.node('#sf-checkout-refresh').hidden, true);
      assert.equal(f.node('#sf-checkout-abort').hidden, true);
      assert.equal(f.node('#sf-totals').hidden, false, 'ordinary browsing shows only a local product estimate');
      assert.equal(f.calls.some(call => call.method === 'POST' && call.path.startsWith('/api/checkout')), false);
      assert.equal(quantity(f), '2', 'history does not clear or restore the basket');
      assert.equal(f.node('#sf-prepare').disabled, false);
      assert.equal(f.node('#sf-new-order').hidden, true);
      assert.equal(f.calls.some(call => call.method === 'POST' && call.path.startsWith('/api/checkout')), false);
      assert.deepEqual(f.errors, []);
    } finally { f.cleanup(); }
  });
}

for (const status of ['PAYABLE', 'CREATING', 'UNKNOWN', 'REVIEW_REQUIRED']) {
  test(`${status} recovery click opens visible context rather than silently rejecting product edits`, async () => {
    const f = await fixture({ authenticated: true, status });
    try {
      assertStarted(f); await f.tick(200);
      assert.equal(quantity(f), '2');
      plus(f).click(); await settle();
      assert.equal(quantity(f), '2');
      assert.equal(f.node('#sf-drawer').open, true, 'the edit block must be visible to a browsing customer');
      assert.match(f.node('#sf-checkout-status').textContent, /awaiting payment|being created|uncertain|manual review/i);
      assert.match(f.node('.sf-card-action .sf-edit-note').textContent, /basket has not changed/i);
      assert.equal(f.node('#sf-checkout-refresh').hidden, false);
      assert.equal(f.node('#sf-new-order').hidden, true);
      assert.equal(f.calls.some(call => call.method === 'POST' && call.path.startsWith('/api/checkout')), false);
      assert.deepEqual(f.errors, []);
    } finally { f.cleanup(); }
  });
}

test('blocked product edit still has inline feedback when another site modal prevents drawer opening', async () => {
  const f = await fixture({ authenticated: true, status: 'PAYABLE' });
  try {
    await f.tick(200);
    f.document.body.classList.add('modal-open');
    plus(f).click();
    assert.equal(quantity(f), '2');
    assert.equal(f.node('#sf-drawer').open, false);
    assert.match(f.node('.sf-card-action .sf-edit-note').textContent, /basket has not changed/i);
    assert.equal(f.node('.sf-edit-note').getAttribute('role'), 'status');
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('resolved edit permission survives privacy pause, but account/logout still clears basket and private DOM', async () => {
  const f = await fixture({ authenticated: true, status: 'PAID' });
  try {
    await f.tick(200);
    f.node('#sf-open').click(); await settle();
    assert.equal(f.node('#sf-accepted-details').textContent, '', 'historical delivery belongs only in account history');
    await f.visibility(false);
    const calls = f.calls.length;
    await f.tick(200); await f.tick(400); await f.tick(5000);
    assert.equal(f.calls.length, calls);
    assert.equal(f.node('#sf-accepted-details').children.length, 0);
    assert.equal(f.node('#sf-checkout-quote').children.length, 0);
    assert.equal(f.node('#sf-delivery-name').value, '');
    assert.equal(f.node('#sf-payment-link').hasAttribute('href'), false);
    await f.visibility(true); await f.tick(200);
    plus(f).click(); minus(f).click(); assert.equal(quantity(f), '2');
    await f.tick(400); await f.tick(200);
    await f.logoutElsewhere();
    assert.equal(quantity(f), '0');
    assert.equal(f.node('#sf-accepted-details').children.length, 0);
    assert.equal(f.node('#sf-new-order').hidden, true);
    assert.equal(f.window.localStorage.getItem(STORAGE_KEY), null);
    plus(f).click(); assert.equal(quantity(f), '1');
    assert.deepEqual(JSON.parse(f.window.localStorage.getItem(STORAGE_KEY)), [{ itemId: 1, quantity: 1 }]);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real anonymous-to-account identity notification merges additions exactly once without cart choices', async () => {
  const f = await fixture();
  try {
    plus(f).click(); assert.equal(quantity(f), '1');
    await f.loginElsewhere(); assertStarted(f);
    assert.equal(quantity(f), '3');
    f.node('#sf-open').click(); await settle();
    assert.equal(f.node('#sf-cart-load').hidden, true);
    assert.equal(f.node('#sf-cart-save').hidden, true);
    assert.match(f.node('.sf-checkout').textContent, /merged/i);
    assert.equal(f.calls.some(call => call.method === 'PUT'), false);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('failed latest-order recovery permits browsing but never prepares or submits a new checkout', async () => {
  const f = await fixture({ authenticated: true, recoveryFails: true });
  try {
    await f.tick(200); assertStarted(f);
    plus(f).click(); assert.equal(quantity(f), '3');
    f.node('#sf-open').click(); await settle();
    assert.equal(f.node('#sf-prepare').disabled, true);
    assert.equal(f.node('#sf-confirm-pay').hidden, true);
    assert.equal(f.node('#sf-checkout-refresh').hidden, false, 'GET recovery fallback remains available');
    assert.equal(f.calls.some(call => call.method === 'POST' && call.path.startsWith('/api/checkout')), false);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

for (const status of [null, 'PAID']) {
test(`real review keeps quote, delivery nodes, focus and scroll through unchanged ${status || 'null'} recovery and focus bursts`, async () => {
  const f = await fixture({ authenticated: true, status });
  try {
    await f.tick(200); f.node('#sf-open').click(); await settle();
    f.node('#sf-prepare').click(); await settle();
    const form = f.node('#sf-delivery'), input = f.node('#sf-delivery-address');
    const quote = f.node('#sf-checkout-quote').firstChild;
    input.value = '999 Customer edited delivery street';
    input.dispatchEvent(new f.window.Event('input', { bubbles: true })); input.focus();
    const panel = f.node('.sf-panel'); panel.scrollTop = 321;
    const calls = f.calls.length;
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    f.intercept(async path => { if (path === '/api/account/checkout') { started(); await delayed; } });
    f.window.dispatchEvent(new f.window.Event('focus'));
    f.window.dispatchEvent(new f.window.Event('focus'));
    await f.visibility(true);
    const refreshing = f.tick(200); await began;
    assert.equal(f.node('#sf-delivery-address').disabled, false, 'quiet recovery cannot disable/blur the edited field');
    assert.equal(f.document.activeElement, input);
    assert.equal(f.node('#sf-checkout-quote').firstChild, quote);
    release(); await refreshing;
    f.intercept(async () => {});
    assert.equal(f.calls.slice(calls).filter(call => call.path === '/api/account/checkout').length, 1, 'focus/visible events freshly check recovery once');
    assert.equal(f.calls.slice(calls).filter(call => call.path === '/api/cart').length, 0, 'return events never reload cart');
    assert.equal(f.node('#sf-delivery'), form);
    assert.equal(f.node('#sf-checkout-quote').firstChild, quote);
    assert.equal(input.value, '999 Customer edited delivery street');
    assert.equal(f.document.activeElement, input);
    assert.equal(panel.scrollTop, 321);
    assert.equal(f.node('#sf-review').disabled, false);
    assert.equal(f.node('#sf-totals').hidden, true);
    form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
    const deliveryNode = f.node('#sf-accepted-details').firstChild;
    const edit = f.node('#sf-accepted-details button'); edit.focus();
    f.window.dispatchEvent(new f.window.Event('focus')); await f.tick(200);
    assert.equal(f.node('#sf-accepted-details').firstChild, deliveryNode);
    assert.equal(f.node('#sf-checkout-quote').firstChild, quote);
    assert.equal(f.document.activeElement, edit);
    assert.equal(panel.scrollTop, 321);
    assert.equal(f.node('#sf-confirm-pay').hidden, false);
    assert.equal(f.calls.filter(call => call.path === '/api/checkout/prepare').length, 1, 'unchanged recovery never re-prepares a quote');
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});
}

test('real still-visible drawer recovers another window pending checkout after initial null on coalesced focus', async () => {
  const f = await fixture({ authenticated: true });
  try {
    await f.tick(200); f.node('#sf-open').click(); await settle();
    f.node('#sf-prepare').click(); await settle();
    assert.equal(f.node('#sf-delivery').hidden, false);
    const count = f.calls.length;
    f.setStatus('PAYABLE');
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    f.intercept(async path => { if (path === '/api/account/checkout') { started(); await delayed; } });
    f.window.dispatchEvent(new f.window.Event('focus'));
    f.window.dispatchEvent(new f.window.Event('focus'));
    const refreshing = f.tick(200); await began;
    f.window.dispatchEvent(new f.window.Event('focus'));
    await f.tick(200);
    assert.equal(f.calls.slice(count).filter(call => call.path === '/api/account/checkout').length, 1, 'in-flight resume is shared, not overlapped');
    release(); await refreshing; await settle();
    assert.equal(f.document.hidden, false);
    assert.equal(f.node('#sf-drawer').open, true);
    assert.equal(f.node('#sf-payment-link').hidden, false);
    assert.equal(f.node('#sf-prepare').hidden, true);
    assert.equal(f.node('#sf-delivery').hidden, true);
    assert.equal(f.node('#sf-confirm-pay').hidden, true);
    assert.equal(f.node('#sf-new-order').hidden, true);
    assert.match(f.node('#sf-checkout-status').textContent, /awaiting payment/);
    const pollsBefore = f.calls.filter(call => call.path === `/api/account/orders/${id}`).length;
    for (let i = 0; i < 15; i++) await f.tick(5000);
    assert.equal(f.calls.filter(call => call.path === `/api/account/orders/${id}`).length - pollsBefore, 10);
    assert.equal(f.scheduled(5000), 0);
    assert.equal(f.calls.some(call => call.path === '/api/checkout'), false);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real current payment polls quietly, stops at PAID, and Continue preserves the newer basket', async () => {
  const f = await fixture({ authenticated: true });
  try {
    await f.tick(200); f.node('#sf-open').click(); await settle();
    f.node('#sf-prepare').click(); await settle();
    f.node('#sf-delivery').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
    f.node('#sf-confirm-pay').click(); await settle();
    assert.equal(f.calls.filter(call => call.path === '/api/checkout').length, 1);
    const link = f.node('#sf-payment-link'), statusNode = f.node('#sf-checkout-status').firstChild;
    const quote = f.node('#sf-checkout-quote'), accepted = f.node('#sf-accepted-details');
    assert.equal(quote.children.length, 0); assert.equal(accepted.children.length, 0);
    link.focus(); f.node('.sf-panel').scrollTop = 432;
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    f.intercept(async path => { if (path === `/api/checkout/${id}`) { started(); await delayed; } });
    const polling = f.tick(5000); await began;
    assert.equal(link.hidden, false, 'busy GET must not remove the payment link');
    assert.equal(f.node('#sf-checkout-status').firstChild, statusNode, 'no checking-message churn');
    assert.equal(f.document.activeElement, link); assert.equal(f.node('.sf-panel').scrollTop, 432);
    release(); await polling;
    assert.equal(f.node('#sf-checkout-status').firstChild, statusNode, 'unchanged response keeps text node');
    assert.equal(f.node('#sf-payment-link'), link);
    assert.equal(f.node('#sf-checkout-quote'), quote); assert.equal(f.node('#sf-accepted-details'), accepted);
    f.setStatus('PAID'); await f.tick(5000);
    assert.match(f.node('#sf-checkout-status').textContent, /Payment received/);
    assert.equal(link.hasAttribute('href'), false);
    assert.equal(f.node('#sf-new-order').hidden, false);
    assert.equal(f.node('#sf-checkout-refresh').hidden, true);
    assert.equal(f.scheduled(5000), 0);
    const calls = f.calls.length; await f.tick(5000); assert.equal(f.calls.length, calls);
    plus(f).click(); assert.equal(quantity(f), '3');
    assert.equal(f.node('#sf-new-order').hidden, false, 'newer basket edits cannot dismiss the current receipt');
    assert.match(f.node('#sf-checkout-status').textContent, /Payment received/);
    await f.tick(400); await f.tick(200);
    f.node('#sf-new-order').click(); await settle();
    assert.equal(quantity(f), '3'); assert.equal(f.cart.lines[0].quantity, 3);
    assert.equal(f.node('#sf-prepare').disabled, false);
    assert.equal(f.node('#sf-new-order').hidden, true);
    assert.equal(f.calls.filter(call => call.path === '/api/checkout').length, 1);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real pending recovery has compact GET-only controls, ten polls, and synchronous privacy clearing', async () => {
  const f = await fixture({ authenticated: true, status: 'PAYABLE' });
  try {
    await f.tick(200); f.node('#sf-open').click(); await settle();
    assert.equal(f.node('#sf-prepare').hidden, true);
    assert.equal(f.node('#sf-cart-load').hidden, true); assert.equal(f.node('#sf-cart-save').hidden, true);
    assert.equal(f.node('#sf-accepted-details').children.length, 0);
    assert.equal(f.node('#sf-checkout-quote').children.length, 0);
    assert.doesNotMatch(f.node('.sf-checkout').textContent, /Fixture customer|123 Fixture Street/);
    const before = f.calls.filter(call => call.path === `/api/account/orders/${id}`).length;
    for (let i = 0; i < 15; i++) await f.tick(5000);
    assert.equal(f.calls.filter(call => call.path === `/api/account/orders/${id}`).length - before, 10);
    assert.equal(f.scheduled(5000), 0);
    const hiding = f.visibility(false);
    assert.equal(f.node('#sf-payment-link').hasAttribute('href'), false);
    assert.equal(f.node('#sf-delivery-name').value, '');
    await hiding;
    const calls = f.calls.length; await f.tick(5000); assert.equal(f.calls.length, calls);
    await f.visibility(true); await f.tick(200);
    assert.equal(f.node('#sf-payment-link').hidden, false);
    await f.logoutElsewhere();
    assert.equal(f.node('#sf-payment-link').hasAttribute('href'), false);
    assert.doesNotMatch(f.node('.sf-checkout').textContent, /WEB-FIXTURE|Fixture customer|123 Fixture Street/);
    assert.equal(f.calls.some(call => call.method === 'POST' && call.path.startsWith('/api/checkout')), false);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real drawer defers recovery until slide completes and late API cannot restart animation or restore closed details', async () => {
  const f = await fixture({ authenticated: true, status: 'PAYABLE', reducedMotion: false });
  try {
    const opener = f.node('#sf-open'); opener.focus(); opener.click();
    const dialog = f.node('#sf-drawer');
    assert.equal(dialog.classList.contains('sf-visible'), true);
    await f.tick(200);
    assert.equal(f.calls.some(call => call.path === '/api/account/checkout'), false, 'startup resume cancelled during slide');
    let release, started;
    const delayed = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { started = resolve; });
    f.intercept(async path => { if (path === '/api/account/checkout') { started(); await delayed; } });
    const opening = f.tick(240); await began;
    assert.equal(f.calls.filter(call => call.path === '/api/account/checkout').length, 1);
    const recovery = f.calls.at(-1);
    assert.equal(dialog.classList.contains('sf-visible'), true);
    assert.equal(f.scheduled(240), 0, 'API work never rearms animation');
    f.node('#sf-close').click();
    assert.equal(recovery.signal.aborted, true);
    assert.equal(dialog.classList.contains('sf-visible'), false);
    release(); await opening; await f.tick(240);
    assert.equal(dialog.open, false); assert.equal(f.document.activeElement, opener);
    assert.equal(f.node('#sf-payment-link').hasAttribute('href'), false);
    const calls = f.calls.length; await f.tick(200); await f.tick(5000); assert.equal(f.calls.length, calls);
    f.intercept(async () => {});
    opener.click(); f.node('#sf-close').click(); opener.click();
    await f.tick(240);
    assert.equal(dialog.open, false, 'close during opening cancels deferred work');
    assert.equal(dialog.classList.contains('sf-visible'), false);
    assert.equal(f.calls.length, calls);
    opener.click(); await f.tick(240);
    assert.equal(dialog.open, true); assert.equal(f.node('#sf-payment-link').hidden, false);
    dialog.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await f.tick(240); assert.equal(dialog.open, false);
    assert.equal(f.document.documentElement.classList.contains('sf-lock'), false);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real drawer closing defers basket saves and an in-flight acknowledgement cannot strand newer edits', async () => {
  const f = await fixture({ authenticated: true, reducedMotion: false });
  try {
    await f.tick(200); f.node('#sf-open').click(); await f.tick(240);
    plus(f).click();
    f.node('#sf-close').click();
    const calls = f.calls.length;
    await f.tick(400); await f.tick(200);
    assert.equal(f.calls.length, calls, 'no save starts during close animation');
    await f.tick(240); await f.tick(400);
    assert.equal(f.cart.lines[0].quantity, 3, 'deferred save resumes with drawer closed');
    f.node('#sf-open').click(); await f.tick(240);
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    f.intercept(async (path, options) => {
      if (path === '/api/cart' && options.method === 'PUT') { started(); await delayed; }
    });
    plus(f).click(); const saving = f.tick(400); await began;
    plus(f).click(); assert.equal(quantity(f), '5'); f.node('#sf-close').click();
    release(); await saving;
    assert.equal(f.cart.lines[0].quantity, 4, 'first immutable save acknowledges normally during close');
    await f.tick(240); f.intercept(async () => {}); await f.tick(400);
    assert.equal(f.cart.lines[0].quantity, 5, 'newer edit saves after animation without reopening');
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real coalesced resume cannot let a late old identity response suppress fresh login recovery', async () => {
  const f = await fixture({ authenticated: true, status: 'PAYABLE' });
  try {
    let release, started;
    const delayed = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { started = resolve; });
    f.intercept(async path => { if (path === '/api/account/checkout') { started(); await delayed; } });
    const boot = f.tick(200); await began;
    const old = f.calls.at(-1);
    await f.logoutElsewhere();
    assert.equal(old.signal.aborted, true);
    assert.equal(f.node('#sf-delivery-name').value, '');
    assert.equal(f.node('#sf-payment-link').hasAttribute('href'), false);
    f.intercept(async () => {});
    await f.loginElsewhere();
    assert.equal(f.calls.filter(call => call.path === '/api/account/checkout').length, 2);
    assert.equal(f.calls.filter(call => call.path === '/api/account/profile').length, 1);
    release(); await boot;
    assert.equal(f.calls.filter(call => call.path === '/api/account/profile').length, 1, 'stale wrapper cannot continue private reads');
    f.node('#sf-open').click(); await settle();
    assert.equal(f.node('#sf-payment-link').hidden, false, 'fresh owned recovery is not suppressed');
    assert.equal(f.node('#sf-accepted-details').children.length, 0);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

const requestCount = (f, path, method) => f.calls.filter(call => call.path === path && (!method || call.method === method)).length;
const chooseDate = async (f, value) => {
  f.node('#sf-date').value = value;
  f.node('#sf-date').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await settle();
};
const sevenDays = (overrides = {}) => Array.from({ length: 7 }, (_, i) => {
  const value = new Date(Date.parse(date) + i * 86400000).toISOString().slice(0, 10);
  return { date: value, maxItems: 5, itemIds: PRODUCT_NAMES.map((_, n) => n + 1), ...overrides[i] };
});

test('real OTP verification aborts old anonymous focus GET; abort-ignoring response cannot undo login or suppress fresh checks', async () => {
  const f = await fixture();
  let release;
  try {
    f.node('#sf-open').click(); await settle();
    f.node('#sf-phone').value = '+919876543210';
    f.node('#sf-send').click(); await settle();
    let started;
    const began = new Promise(resolve => { started = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    let oldSignal;
    f.intercept(async (path, options) => {
      if (path === '/api/session' && !oldSignal) {
        oldSignal = options.signal; started(); await delayed;
        return { ok: true, json: async () => ({ authenticated: false, customer: null,
          csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: 'stale-anonymous' }) };
      }
    });
    f.window.dispatchEvent(new f.window.Event('focus'));
    const old = f.tick(200); await began;
    f.node('#sf-code').value = '123456';
    f.node('#sf-code').dispatchEvent(new f.window.Event('input'));
    f.node('#sf-auth form').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(oldSignal.aborted, true);
    assert.equal(f.node('#sf-logout').hidden, false, 'OTP succeeds while the old GET is still pending');
    f.intercept(async () => {});
    await f.tick(200);
    assert.equal(requestCount(f, '/api/cart', 'GET'), 1, 'fresh recovery is not coalesced behind old GET');
    release(); await old;
    assert.equal(f.node('#sf-logout').hidden, false);
    assert.equal(quantity(f), '2');
    assert.match(f.node('.product-price-group').textContent, /Fixture special rate/);
    assert.deepEqual(f.errors, []);
  } finally { release?.(); f.cleanup(); }
});

test('real prepare CART_CONFLICT exposes explicit bounded version-only basket retry, then fresh Review; never checkout replay', async () => {
  const f = await fixture({ authenticated: true });
  try {
    await f.tick(200); f.node('#sf-open').click(); await settle();
    let conflict = true, putConflict = true;
    f.intercept(async (path, options) => {
      if (path === '/api/checkout/prepare' && conflict) {
        conflict = false;
        return { ok: false, status: 409, json: async () => ({ problems: [{ code: 'CART_CONFLICT' }] }) };
      }
      if (path === '/api/cart' && options.method === 'PUT' && putConflict) {
        putConflict = false;
        return { ok: false, status: 409, json: async () => ({ problems: [{ code: 'CART_CONFLICT' }] }) };
      }
      if (path === '/api/cart' && options.method === 'GET') return { ok: true,
        json: async () => ({ version: 8, lines: [{ itemId: 99, quantity: 90 }], date: 'invalid', quote: 'not adopted' }) };
    });
    f.node('#sf-prepare').click(); await settle();
    assert.equal(f.node('#sf-cart-save').hidden, false);
    assert.equal(f.node('#sf-prepare').disabled, true);
    const count = f.calls.length;
    await f.tick(200); await f.tick(400);
    assert.equal(f.calls.length, count, 'conflict never automatically saves or re-prepares');
    f.node('#sf-cart-save').click(); await settle();
    assert.deepEqual(f.calls.slice(count).filter(call => call.path === '/api/cart').map(call => call.method), ['PUT', 'GET', 'PUT']);
    assert.equal(quantity(f), '2');
    assert.equal(f.cart.version, 9);
    assert.deepEqual(f.cart.lines, [{ itemId: 1, quantity: 2 }]);
    assert.equal(f.cart.date, date);
    assert.equal(f.node('#sf-cart-save').hidden, true);
    assert.equal(f.node('#sf-prepare').disabled, false);
    assert.equal(requestCount(f, '/api/checkout/prepare'), 1);
    f.node('#sf-prepare').click(); await settle();
    assert.equal(requestCount(f, '/api/checkout/prepare'), 2);
    assert.equal(f.node('#sf-delivery').hidden, false);
    assert.equal(requestCount(f, '/api/checkout'), 0);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real 3+3 overflow keeps original guest storage through reload; only accepted reduced save retires it', async () => {
  const guest = [{ itemId: 1, quantity: 3 }];
  let f = await fixture({ authenticated: true, storageLines: guest, accountLines: guest });
  let retained;
  try {
    await f.tick(200);
    assert.equal(quantity(f), '6');
    retained = JSON.parse(f.window.localStorage.getItem(STORAGE_KEY));
    assert.deepEqual(retained, guest);
    assert.equal(f.window.localStorage.getItem(GUEST_RECEIPT_KEY), null, 'overflow sends no PUT');
    f.node('#sf-open').click(); await settle();
    assert.match(f.node('.sf-checkout').textContent, /unsaved.*only on this page/i);
    assert.equal(requestCount(f, '/api/cart', 'PUT'), 0);
  } finally { f.cleanup(); }
  f = await fixture({ authenticated: true, storageLines: retained, accountLines: guest });
  try {
    await f.tick(200); assert.equal(quantity(f), '6', 'reload reconstructs merge from original guest only');
    minus(f).click(); assert.equal(quantity(f), '5');
    let release, started;
    const delayed = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { started = resolve; });
    f.intercept(async (path, options) => { if (path === '/api/cart' && options.method === 'PUT') { started(); await delayed; } });
    const saving = f.tick(400); await began;
    assert.deepEqual(JSON.parse(f.window.localStorage.getItem(STORAGE_KEY)), guest);
    assert.equal(f.window.localStorage.getItem(GUEST_RECEIPT_KEY), 'pending');
    release(); await saving;
    assert.equal(f.cart.lines[0].quantity, 5);
    assert.equal(f.window.localStorage.getItem(STORAGE_KEY), null);
    assert.equal(f.window.localStorage.getItem(GUEST_RECEIPT_KEY), null);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

for (const committed of [false, true]) {
  test(`real lost guest save acknowledgement, committed=${committed}: reload never double-merges, keeps original, explicit resolution only`, async () => {
    const guest = [{ itemId: 1, quantity: 1 }], saved = [{ itemId: 1, quantity: 2 }];
    let f = await fixture({ authenticated: true, storageLines: guest, accountLines: saved });
    let remote, retained;
    try {
      await f.tick(200); assert.equal(quantity(f), '3');
      f.intercept(async (path, options) => {
        if (path === '/api/cart' && options.method === 'PUT') {
          if (committed) {
            const body = JSON.parse(options.body);
            f.setCart({ ...body, version: body.version + 1, quote: quoteFor(body.lines, body.date), problems: [] });
          }
          throw new TypeError('lost acknowledgement');
        }
      });
      await f.tick(400);
      retained = JSON.parse(f.window.localStorage.getItem(STORAGE_KEY));
      assert.deepEqual(retained, guest);
      assert.equal(f.window.localStorage.getItem(GUEST_RECEIPT_KEY), 'pending');
      remote = f.cart.lines;
    } finally { f.cleanup(); }
    f = await fixture({ authenticated: true, storageLines: retained, accountLines: remote, guestReceipt: true });
    try {
      await f.tick(200); f.node('#sf-open').click(); await settle();
      assert.equal(quantity(f), committed ? '3' : '2');
      assert.equal(requestCount(f, '/api/cart', 'PUT'), 0);
      assert.equal(f.node('#sf-prepare').disabled, true);
      assert.equal(f.node('#sf-guest-discard').hidden, false);
      assert.match(f.node('.sf-checkout').textContent, /NOT added again/);
      assert.deepEqual(JSON.parse(f.window.localStorage.getItem(STORAGE_KEY)), guest);
      f.node('#sf-guest-discard').click(); await settle();
      assert.equal(quantity(f), committed ? '3' : '2', 'explicit discard never adds or replaces account lines');
      assert.equal(f.window.localStorage.getItem(STORAGE_KEY), null);
      assert.equal(f.window.localStorage.getItem(GUEST_RECEIPT_KEY), null);
      assert.equal(f.node('#sf-prepare').disabled, false);
      assert.equal(requestCount(f, '/api/checkout'), 0);
      assert.deepEqual(f.errors, []);
    } finally { f.cleanup(); }
  });
}

test('real overflow logout and anonymous edits cannot overwrite retained guest original or retire it on a clean login GET', async () => {
  const guest = [{ itemId: 1, quantity: 3 }];
  const f = await fixture({ authenticated: true, storageLines: guest, accountLines: guest });
  try {
    await f.tick(200); assert.equal(quantity(f), '6');
    await f.logoutElsewhere();
    plus(f).click(); assert.equal(quantity(f), '1');
    assert.deepEqual(JSON.parse(f.window.localStorage.getItem(STORAGE_KEY)), guest);
    assert.match(f.node('#sf-status').textContent, /Original device additions remain stored/);
    await f.loginElsewhere();
    assert.equal(quantity(f), '3', 'later identity does not silently consume retained guest additions');
    assert.deepEqual(JSON.parse(f.window.localStorage.getItem(STORAGE_KEY)), guest);
    f.node('#sf-open').click(); await settle();
    assert.equal(f.node('#sf-guest-discard').hidden, false);
    assert.equal(requestCount(f, '/api/cart', 'PUT'), 0);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real shopping/cart request budget: bootstrap after CSRF, once on login; no quote or reload per quantity, focus or drawer', async () => {
  const f = await fixture();
  try {
    assertStarted(f);
    assert.deepEqual(f.calls.slice(0, 3).map(call => call.path), ['/api/catalog', '/api/session', '/api/shopping']);
    assert.equal(requestCount(f, '/api/shopping'), 1);
    const before = f.calls.length;
    plus(f).click(); plus(f).click(); minus(f).click(); await f.tick(200); await f.tick(400);
    assert.equal(f.calls.length, before, 'anonymous clicks perform no network operations');
    await f.loginElsewhere(); await f.tick(200);
    assert.equal(quantity(f), '3');
    assert.equal(requestCount(f, '/api/shopping'), 2);
    assert.equal(requestCount(f, '/api/cart', 'GET'), 1);
    await f.tick(400);
    plus(f).click(); minus(f).click(); await f.tick(400);
    for (let i = 0; i < 3; i++) {
      f.node('#sf-open').click(); await settle();
      f.window.dispatchEvent(new f.window.Event('focus')); await f.tick(200);
      f.node('#sf-close').click(); await settle();
    }
    assert.equal(requestCount(f, '/api/shopping'), 2);
    assert.equal(requestCount(f, '/api/cart', 'GET'), 1);
    assert.equal(requestCount(f, '/api/quote'), 0);
    assert.equal(f.window.localStorage.getItem(STORAGE_KEY), null);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real card prices personalize on login, local integer-paise estimate updates, logout restores public snapshot prices', async () => {
  const f = await fixture();
  try {
    const price = f.node('.product-price-group');
    assert.match(price.textContent, /20\.00/);
    plus(f).click(); assert.match(f.node('#sf-totals').textContent, /20\.00/);
    await f.loginElsewhere(); await f.tick(200);
    assert.match(price.textContent, /15\.00.*Fixture special rate/);
    assert.match(f.node('#sf-totals').textContent, /45\.00/);
    assert.match(f.node('#sf-totals').textContent, /before batch, delivery, basket promotions and credit/);
    assert.match(f.node('#sf-totals').textContent, /may not jointly win for a mixed basket/);
    assert.doesNotMatch(f.node('#sf-totals').textContent, /Checkout total|Credit applied|Delivery charge|Savings/);
    f.node('#sf-open').click(); await settle();
    f.node('#sf-logout').click(); await settle();
    assert.match(price.textContent, /20\.00/);
    assert.doesNotMatch(f.document.body.textContent, /Fixture special rate/);
    assert.equal(quantity(f), '0', 'verified logout removes account-owned lines, not anonymous additions');
    assert.equal(requestCount(f, '/api/shopping'), 3);
    assert.equal(requestCount(f, '/api/quote'), 0);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real one-slot date keeps + enabled with visible no-change bulk feedback, quantities never fetch shopping', async () => {
  const f = await fixture({ shoppingDates: sevenDays({ 0: { maxItems: 1 } }) });
  try {
    await chooseDate(f, date);
    assert.equal(requestCount(f, '/api/shopping'), 2);
    plus(f).click(); assert.equal(quantity(f), '1');
    plus(f).click(); assert.equal(quantity(f), '1');
    assert.equal(plus(f).disabled, false);
    assert.match(f.node('.sf-edit-note').textContent, /Basket unchanged.*contact the bakery for a bulk order/);
    assert.match(f.node('.sf-edit-note').getAttribute('role'), /status/);
    assert.equal(f.node('#sf-date').value, date);
    assert.doesNotMatch(f.node('#sf-date').textContent, /remaining|slots|capacity|1 item/i);
    await f.tick(200); await f.tick(400);
    assert.equal(requestCount(f, '/api/shopping'), 2);
    assert.equal(requestCount(f, '/api/quote'), 0);
    minus(f).click(); assert.equal(quantity(f), '0'); plus(f).click(); assert.equal(quantity(f), '1');
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real date-first eligibility labels ineligible cards but retains their prices/catalog mapping across scoped responses', async () => {
  const dates = sevenDays({ 0: { itemIds: [1] } });
  const f = await fixture({ shoppingDates: dates });
  try {
    await chooseDate(f, date);
    const second = f.document.querySelectorAll('.sf-card-action')[1];
    assert.match(second.querySelector('.sf-availability').textContent, /Unavailable/);
    assert.match(second.closest('.text').querySelector('.product-price-group').textContent, /20\.00/);
    second.querySelector('button:last-child').click();
    assert.equal(second.querySelector('.sf-quantity span').textContent, '0');
    assert.match(second.querySelector('.sf-edit-note').textContent, /Basket unchanged/);
    await chooseDate(f, dates[1].date);
    assert.equal(second.querySelector('.sf-availability').textContent, '');
    second.querySelector('button:last-child').click();
    assert.equal(second.querySelector('.sf-quantity span').textContent, '1');
    assert.equal(f.node('#sf-date').value, dates[1].date);
    assert.equal(requestCount(f, '/api/shopping'), 3);
    assert.equal(requestCount(f, '/api/quote'), 0);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real bread-first dates fit the entire basket; incompatible additions and invalid date changes never discard intent', async () => {
  const dates = sevenDays({ 0: { itemIds: [1] }, 1: { itemIds: [2] } });
  const f = await fixture({ shoppingDates: dates });
  try {
    plus(f).click();
    let options = [...f.node('#sf-date').options];
    assert.equal(options.find(option => option.value === dates[0].date).disabled, false);
    assert.equal(options.find(option => option.value === dates[1].date).disabled, true);
    const second = f.document.querySelectorAll('.sf-card-action')[1];
    second.querySelector('button:last-child').click();
    options = [...f.node('#sf-date').options];
    assert.equal(options.find(option => option.value === dates[0].date).disabled, true);
    assert.equal(options.find(option => option.value === dates[1].date).disabled, true);
    assert.equal(options.find(option => option.value === dates[2].date).disabled, false);
    await chooseDate(f, dates[2].date);
    await chooseDate(f, dates[0].date); // Even a synthetic event cannot bypass controls.
    assert.equal(f.node('#sf-date').value, dates[2].date);
    assert.equal(quantity(f), '1');
    assert.equal(second.querySelector('.sf-quantity span').textContent, '1');
    assert.match(f.node('#sf-status').textContent, /Date unchanged.*bulk order/);
    assert.equal(requestCount(f, '/api/shopping'), 2);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real merge overflow and legacy oversized carts retain all units, block addition/checkout and can reduce to a saveable five', async () => {
  for (const [storageLines, accountLines, expected] of [
    [[{ itemId: 1, quantity: 3 }], [{ itemId: 1, quantity: 3 }], 6],
    [[], [{ itemId: 1, quantity: 8 }], 8]
  ]) {
    const f = await fixture({ authenticated: true, storageLines, accountLines });
    try {
      await f.tick(200);
      assert.equal(quantity(f), String(expected));
      assert.equal(f.node('#sf-date').value, '');
      assert.match(f.node('#sf-status').textContent, /kept in full.*five.*bulk order/);
      plus(f).click(); assert.equal(quantity(f), String(expected));
      assert.equal(plus(f).disabled, false);
      f.node('#sf-open').click(); await settle();
      assert.equal(f.node('#sf-prepare').disabled, true);
      await f.tick(400); assert.equal(requestCount(f, '/api/cart', 'PUT'), 0);
      for (let n = expected; n > 5; n--) minus(f).click();
      assert.equal(quantity(f), '5');
      plus(f).click(); assert.equal(quantity(f), '5');
      await chooseDate(f, date); await f.tick(400);
      assert.equal(f.cart.lines[0].quantity, 5);
      assert.equal(f.node('#sf-prepare').disabled, false);
      assert.equal(requestCount(f, '/api/cart', 'GET'), 1);
      assert.deepEqual(f.errors, []);
    } finally { f.cleanup(); }
  }
});

test('real edits during initial cart load merge current additions once and never silently lose overflow', async () => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  const f = await fixture({ authenticated: true, storageLines: [{ itemId: 1, quantity: 1 }],
    initialHook: async (path, options) => {
      if (path === '/api/cart' && options.method === 'GET') { started(); await delayed; }
    } });
  try {
    const loading = f.tick(200); await began;
    plus(f).click(); plus(f).click();
    assert.equal(quantity(f), '3');
    release(); await loading;
    assert.equal(quantity(f), '5');
    await f.tick(200); f.node('#sf-open').click(); await settle();
    assert.equal(quantity(f), '5');
    assert.equal(requestCount(f, '/api/cart', 'GET'), 1);
    await f.tick(400); assert.equal(f.cart.lines[0].quantity, 5);
    assert.equal(f.window.localStorage.getItem(STORAGE_KEY), null);
    assert.deepEqual(f.errors, []);
  } finally { release(); f.cleanup(); }
});

test('real late save acknowledgements never replace newer preview; 409 reads only version and retries latest local intent once', async () => {
  const f = await fixture({ authenticated: true });
  try {
    await f.tick(200);
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    let conflicted = false;
    f.intercept(async (path, options) => {
      if (path !== '/api/cart') return;
      if (options.method === 'PUT' && !conflicted) {
        conflicted = true;
        return { ok: false, status: 409, json: async () => ({ problems: [{ code: 'CART_CONFLICT' }] }) };
      }
      if (options.method === 'GET') {
        started(); await delayed;
        return { ok: true, json: async () => ({ version: 9, lines: [{ itemId: 2, quantity: 99 }], date: null, quote: 'not trusted' }) };
      }
    });
    plus(f).click(); const saving = f.tick(400); await began;
    plus(f).click(); assert.equal(quantity(f), '4');
    const estimateNode = f.node('#sf-totals').firstChild;
    release(); await saving;
    assert.equal(quantity(f), '4');
    assert.equal(f.cart.lines[0].quantity, 4);
    assert.equal(f.node('#sf-totals').firstChild, estimateNode, 'quiet acknowledgements cannot render server quotes');
    assert.deepEqual(f.calls.filter(call => call.path === '/api/cart' && call.method === 'PUT').map(call => [call.body.version, call.body.lines[0].quantity]), [[1, 3], [9, 4]]);
    assert.equal(requestCount(f, '/api/cart', 'GET'), 2);
    assert.equal(requestCount(f, '/api/shopping'), 1);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real hide/offline clears personalized prices and private fields without basket loss or identity reload', async () => {
  const f = await fixture({ authenticated: true });
  try {
    await f.tick(200); plus(f).click();
    f.node('#sf-open').click(); await settle();
    await f.visibility(false);
    const before = f.calls.length;
    assert.equal(quantity(f), '3');
    assert.doesNotMatch(f.node('.product-price-group').textContent, /Fixture special rate/);
    assert.equal(f.node('#sf-delivery-name').value, '');
    await f.tick(200); await f.tick(400); await f.tick(5000);
    assert.equal(f.calls.length, before);
    await f.visibility(true); await f.tick(200);
    assert.equal(quantity(f), '3');
    assert.match(f.node('.product-price-group').textContent, /Fixture special rate/);
    assert.equal(requestCount(f, '/api/cart', 'GET'), 1);
    assert.equal(requestCount(f, '/api/shopping'), 1);
    await f.offline(); assert.equal(quantity(f), '3');
    await f.online(); assert.equal(quantity(f), '3');
    assert.doesNotMatch(f.node('.product-price-group').textContent, /Fixture special rate/);
    assert.equal(requestCount(f, '/api/shopping'), 1, 'offline return does not silently poll availability');
    f.node('#sf-refresh').click(); await settle(); await f.tick(200);
    assert.equal(requestCount(f, '/api/shopping'), 2);
    assert.match(f.node('.product-price-group').textContent, /Fixture special rate/);
    assert.equal(requestCount(f, '/api/cart', 'GET'), 1);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real late scoped shopping response cannot restore an older date or price after a newer date snapshot', async () => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  const dates = sevenDays();
  const f = await fixture({ shoppingDates: dates, shoppingHook: async (value, { body }) => {
    if (body.date === dates[0].date) { started(); await delayed; return { ...value, items: value.items.map(item => ({ ...item, unitPrice: 1 })) }; }
    return value;
  } });
  try {
    const old = chooseDate(f, dates[0].date); await began;
    // Date selection remains available from the last bootstrap; an in-flight
    // request is not permission to erase a user's newer date choice.
    f.node('#sf-date').value = dates[1].date;
    f.node('#sf-date').dispatchEvent(new f.window.Event('change'));
    await settle(); release(); await old; await settle();
    assert.equal(f.node('#sf-date').value, dates[1].date);
    assert.match(f.node('.product-price-group').textContent, /20\.00/);
    assert.equal(requestCount(f, '/api/shopping'), 3);
    assert.deepEqual(f.errors, []);
  } finally { release(); f.cleanup(); }
});

for (const stage of ['/api/session', '/api/shopping']) {
  test(`real startup hidden during ${stage} aborts and cannot enhance or fetch the next stage until visible`, async () => {
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    let paused = false;
    const f = await fixture({ authenticated: true, initialHook: async path => {
      if (path === stage && !paused) { paused = true; started(); await delayed; }
    } });
    try {
      await began; await f.visibility(false);
      const call = f.calls.find(call => call.path === stage);
      assert.equal(call.signal.aborted, true);
      release(); await settle();
      assert.equal(f.node('#sf-open'), null);
      assert.equal(f.node('.sf-card-action'), null);
      if (stage === '/api/session') assert.equal(requestCount(f, '/api/shopping'), 0);
      const count = f.calls.length;
      await f.tick(200); await f.tick(400); assert.equal(f.calls.length, count);
      await f.visibility(true); assertStarted(f); await f.tick(200);
      assert.equal(quantity(f), '2');
      assert.deepEqual(f.errors, []);
    } finally { release(); f.cleanup(); }
  });
}

test('real failed snapshot cannot be resurrected by same-identity focus or drawer; explicit successful refresh is required', async () => {
  const f = await fixture({ authenticated: true });
  try {
    await f.tick(200);
    f.intercept(async path => path === '/api/shopping' ? { ok: false, status: 503, json: async () => ({}) } : undefined);
    await chooseDate(f, sevenDays()[1].date);
    assert.doesNotMatch(f.node('.product-price-group').textContent, /Fixture special rate/);
    f.window.dispatchEvent(new f.window.Event('focus')); await f.tick(200);
    f.node('#sf-open').click(); await settle();
    assert.doesNotMatch(f.node('.product-price-group').textContent, /Fixture special rate/);
    plus(f).click(); assert.equal(quantity(f), '2');
    assert.equal(f.node('#sf-prepare').disabled, true);
    assert.equal(requestCount(f, '/api/shopping'), 2);
    f.intercept(async () => {}); f.node('#sf-refresh').click(); await settle();
    assert.match(f.node('.product-price-group').textContent, /Fixture special rate/);
    assert.equal(requestCount(f, '/api/cart', 'GET'), 1);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('real failed save keeps edits and offers retry only; exact authoritative quote and server rejection appear only at Review', async () => {
  const f = await fixture({ authenticated: true });
  try {
    await f.tick(200); f.node('#sf-open').click(); await settle();
    f.intercept(async (path, options) => path === '/api/cart' && options.method === 'PUT' ?
      { ok: false, status: 503, json: async () => ({}) } : undefined);
    plus(f).click(); await f.tick(400);
    assert.equal(quantity(f), '3');
    assert.equal(f.node('#sf-cart-save').hidden, false);
    assert.match(f.node('#sf-cart-save').textContent, /Retry saving/);
    assert.equal(f.node('#sf-cart-load').hidden, true);
    assert.equal(f.node('#sf-prepare').disabled, true);
    const calls = f.calls.length; await f.tick(400); assert.equal(f.calls.length, calls);
    assert.equal(f.node('#sf-checkout-quote').children.length, 0);
    f.intercept(async () => {}); f.node('#sf-cart-save').click(); await settle();
    assert.equal(f.cart.lines[0].quantity, 3);
    assert.equal(f.node('#sf-cart-save').hidden, true);
    f.intercept(async path => path === '/api/checkout/prepare' ?
      { ok: false, status: 409, json: async () => ({ problems: [{ code: 'RETAIL_LIMIT_EXCEEDED', message: 'never render private server text' }] }) } : undefined);
    f.node('#sf-prepare').click(); await settle();
    assert.match(f.node('#sf-checkout-status').textContent, /five items total.*bulk order/);
    assert.doesNotMatch(f.node('.sf-checkout').textContent, /never render private server text/);
    assert.equal(f.node('#sf-confirm-pay').hidden, true);
    assert.equal(f.node('#sf-checkout-quote').children.length, 0);
    f.intercept(async () => {}); f.node('#sf-prepare').click(); await settle();
    assert.match(f.node('#sf-checkout-quote').textContent, /Review your order/);
    assert.match(f.node('#sf-checkout-quote').textContent, /Checkout total/);
    assert.equal(f.node('#sf-totals').hidden, true);
    // Fixture final total is deliberately not the local 3 × special-rate 15.
    assert.match(f.node('#sf-checkout-quote').textContent, /40\.00/);
    assert.equal(requestCount(f, '/api/quote'), 0);
    assert.equal(requestCount(f, '/api/checkout'), 0);
    assert.equal(requestCount(f, '/api/cart', 'GET'), 1);
    assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});