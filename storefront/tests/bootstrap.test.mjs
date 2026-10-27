import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { PRODUCT_NAMES, STORAGE_KEY } from '../model.mjs';

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
  accountLines = [{ itemId: 1, quantity: 2 }], recoveryFails = false, reducedMotion = true } = {}) {
  const errors = [], calls = [], timers = new Map(), intervals = new Map(), timerCalls = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  // No scripts/resources run in jsdom: all network is the exact fake API below.
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/breads.html', virtualConsole });
  const { window } = dom, { document } = window;
  let visible = !hidden, online = true, loggedIn = authenticated, timerId = 0;
  let requestHook = async () => {};
  let cart = { version: 1, lines: structuredClone(accountLines), date, quote: quoteFor(accountLines), problems: [] };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  window.TRANCHE_STOREFRONT = { enabled: true, checkoutEnabled: true };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storageLines));
  // jsdom provides the real DOM/event tree but not native top-layer dialog methods.
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const session = () => ({ authenticated: loggedIn, customer: loggedIn ? { id: 7 } : null,
    csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: 'fixture-csrf' });
  const fetcher = async (path, options) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    calls.push({ path, method: options.method, body, signal: options.signal });
    await requestHook(path, options);
    let value;
    if (path === '/api/catalog') value = { items: PRODUCT_NAMES.map((name, i) => ({ id: i + 1, name })), deliveryDates: [date] };
    else if (path === '/api/session') value = session();
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
    async tick(ms) {
      const ready = [...timers].filter(([, timer]) => timer.ms === ms);
      for (const [key, timer] of ready) if (timers.delete(key)) timer.callback();
      await settle();
    },
    async visibility(value) { visible = value; document.dispatchEvent(new window.Event('visibilitychange')); await settle(); },
    async offline() { online = false; window.dispatchEvent(new window.Event('offline')); await settle(); },
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
      assert.equal(f.node('#sf-totals').hidden, true, 'only checkout owns the signed-in quote');
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
    await f.visibility(true);
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

test('real anonymous-to-account identity notification initializes safely and does not silently merge baskets', async () => {
  const f = await fixture();
  try {
    plus(f).click(); assert.equal(quantity(f), '1');
    await f.loginElsewhere(); assertStarted(f);
    assert.equal(quantity(f), '1');
    f.node('#sf-open').click(); await settle();
    assert.equal(f.node('#sf-cart-load').hidden, false);
    assert.equal(f.node('#sf-cart-save').hidden, false);
    assert.match(f.node('.sf-checkout').textContent, /different baskets/i);
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
    assert.equal(f.calls.slice(calls).filter(call => call.path === '/api/cart').length, 1, 'return events coalesce');
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