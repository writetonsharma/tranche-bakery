import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutEnabled, validateCart, cartInput, validatePrepared, fulfillment,
  paymentUrl, validateCheckout, problemMessage } from '../checkout-model.mjs';
import { CheckoutFlow } from '../checkout-flow.mjs';
import { StorefrontApi } from '../api.mjs';
import { attachCheckout } from '../checkout-view.mjs';

const now = Date.parse('2026-10-26T08:00:00Z');
const id = 'a'.repeat(32);
const ids = new Set([1]);
const basket = { lines: [{ itemId: 1, quantity: 2 }], date: '2026-11-01' };
const quote = { valid: true, date: basket.date, lines: [{ ...basket.lines[0], name: 'Bread', unitPrice: 20, lineTotal: 40 }],
  problems: [], listSubtotal: 40, discountAmount: 0, batchDiscountAmount: 0, deliveryCharge: 50, creditApplied: 0, totalAmount: 90 };
const cart = { version: 1, ...basket, quote, problems: [] };
const retiredCart = { version: 12, lines: [{ itemId: 99, quantity: 3 }, ...basket.lines],
  date: '2026-10-01', quote: null, problems: [{ code: 'ITEM_UNAVAILABLE', message: 'private backend text' }] };
const prepared = { cartVersion: 1, quote, quoteToken: 't'.repeat(43), expiresAt: '2026-10-26T08:10:00Z' };
const details = { name: 'Customer', address: '123 Example Street, Gurugram', deliveryPreference: 'GATE', loafPreference: 'SLICED' };
const payable = { id, status: 'PAYABLE', paymentUrl: 'https://rzp.io/i/example', expiresAt: '2026-10-31T12:30:00Z' };
const session = { authenticated: true, customer: { id: 7 }, csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: 'csrf' };
function fixture(handler = () => payable, enabled = true, accountCart = cart) {
  const calls = [];
  let local = structuredClone(basket);
  const api = { async session() { return session; }, async request(path, body, signal, method) {
    calls.push({ path, body: structuredClone(body), signal, method });
    if (path === '/api/cart') return method === 'PUT' ? { ...cart, ...body, version: body.version + 1 } : structuredClone(accountCart);
    if (path === '/api/checkout/prepare') return structuredClone(prepared);
    return handler(path, body, signal);
  } };
  let changes = 0;
  const flow = new CheckoutFlow({ api, enabled, allowedIds: ids, now: () => now,
    uuid: () => '12345678-1234-4234-8234-123456789abc', getBasket: () => local,
    onBasket: value => { local = value; }, onChange: () => changes++ });
  flow.setIdentity(7);
  return { flow, calls, get local() { return local; }, get changes() { return changes; } };
}
test('checkout independently requires strict true; preview flag alone never enables it', () => {
  for (const checkoutEnabledValue of [false, undefined, 1, 'true']) {
    assert.equal(checkoutEnabled({ enabled: true, checkoutEnabled: checkoutEnabledValue }), false);
  }
  assert.equal(checkoutEnabled({ enabled: false, checkoutEnabled: true }), false);
  assert.equal(checkoutEnabled({ enabled: true, checkoutEnabled: true }), true);
});
test('durable cart exact versions, quantities and India date bounds reject coercion', () => {
  assert.deepEqual(cartInput(0, basket, ids, now), { version: 0, ...basket });
  for (const version of [-1, '1', 1.2, Number.MAX_SAFE_INTEGER]) assert.throws(() => cartInput(version, basket, ids, now));
  for (const date of ['2026-02-30', '2026-10-25', '2026-12-26', '2026-11-01T00:00:00Z']) {
    assert.throws(() => cartInput(1, { ...basket, date }, ids, now));
  }
  assert.throws(() => cartInput(1, { ...basket, lines: [{ itemId: 1, quantity: '2' }] }, ids, now));
  assert.equal(cartInput(1, { ...basket, date: '' }, ids, now).date, null);
  assert.equal(cartInput(1, { ...basket, date: '2026-12-25' }, ids, now).date, '2026-12-25');
});
test('GET cart permits stale dates and null quote without changing version; safe problems only', () => {
  const value = validateCart({ ...cart, date: '2026-10-01', quote: null,
    problems: [{ code: 'DATE_UNAVAILABLE', message: 'secret phone' }] }, ids);
  assert.equal(value.version, 1);
  assert.equal(value.quote, null);
  assert.doesNotMatch(JSON.stringify(value), /secret phone/);
  assert.throws(() => validateCart({ ...cart, version: '1' }, ids));
});
test('persisted retired IDs retain strict line structure but outgoing lines still require current catalogue', () => {
  const value = validateCart(retiredCart);
  assert.equal(value.version, 12);
  assert.deepEqual(value.lines, retiredCart.lines);
  assert.equal(value.date, retiredCart.date);
  assert.equal(value.quote, null);
  assert.ok(Object.isFrozen(value.lines[0]));
  assert.doesNotMatch(JSON.stringify(value), /private backend text/);
  assert.throws(() => cartInput(value.version, { ...basket, lines: value.lines }, ids, now));
  assert.deepEqual(cartInput(value.version, basket, ids, now), { version: 12, ...basket });
  for (const lines of [null, {}, [null], [{ itemId: 99 }], [{ itemId: 99, quantity: 1, name: 'retired' }],
    [{ itemId: 99, quantity: 1 }, { itemId: 99, quantity: 2 }],
    Array.from({ length: 41 }, (_, i) => ({ itemId: i + 1, quantity: 1 })),
    ...[0, -1, 1.5, '99', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(itemId => [{ itemId, quantity: 1 }]),
    ...[0, -1, 1.5, '1', 100, NaN, Infinity].map(quantity => [{ itemId: 99, quantity }])]) {
    assert.throws(() => validateCart({ ...retiredCart, lines }));
  }
  for (const version of [-1, 1.5, '12', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateCart({ ...retiredCart, version }));
  }
  assert.equal(validateCart({ ...retiredCart, version: Number.MAX_SAFE_INTEGER }).version, Number.MAX_SAFE_INTEGER);
  assert.throws(() => cartInput(Number.MAX_SAFE_INTEGER, basket, ids, now));
  assert.throws(() => validateCart({ ...retiredCart, date: '2026-02-30' }));
  assert.throws(() => validateCart({ ...retiredCart, quote })); // Quote must still bind exact persisted lines/date.
});
test('prepared acceptance binds owned version, exact lines/date and unexpired immutable server quote', () => {
  const value = validatePrepared(prepared, cart, now);
  assert.equal(value.quote.totalAmount, 90);
  assert.ok(Object.isFrozen(value.quote.lines[0]));
  for (const value of [{ ...prepared, cartVersion: 2 }, { ...prepared, quoteToken: '' },
    { ...prepared, expiresAt: '2026-10-26T07:59:00Z' }, { ...prepared, quote: { ...quote, valid: false } },
    { ...prepared, quote: { ...quote, date: '2026-11-02' } }]) assert.throws(() => validatePrepared(value, cart, now));
});
test('fulfillment trims and snapshots exact preferences, forbids controls and bad lengths', () => {
  assert.deepEqual(fulfillment({ ...details, name: ' Customer ' }), details);
  for (const value of [{ ...details, name: '' }, { ...details, name: 'x'.repeat(101) },
    { ...details, address: 'short' }, { ...details, address: 'a'.repeat(2001) },
    { ...details, address: '123 Example\nStreet' }, { ...details, name: 'A\u007fB' },
    { ...details, deliveryPreference: 'door' }, { ...details, loafPreference: 'other' },
    { ...details, phone: '+919999999999' }]) assert.throws(() => fulfillment(value));
});
test('payment URLs exact HTTPS hosts and nonempty safe paths only, no credentials/ports/fragments', () => {
  for (const url of ['https://rzp.io/i/abc', 'https://razorpay.com/payment-link/abc']) assert.equal(paymentUrl(url), url);
  for (const url of ['http://rzp.io/i/a', 'https://rzp.io.evil/i/a', 'https://sub.razorpay.com/a',
    'https://x@rzp.io/a', 'https://rzp.io:443/a', 'https://rzp.io:8443/a', 'https://rzp.io/a#x',
    'https://rzp.io', 'https://rzp.io/', 'https://rzp.io/../a', 'https://rzp.io/%2f%2fevil',
    'https://rzp.io/a?redirect=https://evil.test', 'https://rzp.io\\evil/a', ' https://rzp.io/a']) {
    assert.throws(() => paymentUrl(url), url);
  }
});
test('only owned PAYABLE can expose link; nonpayable, expired and unknown states fail closed', () => {
  assert.equal(validateCheckout(payable, id, now).paymentUrl, payable.paymentUrl);
  for (const status of ['CREATING', 'UNKNOWN', 'PAID', 'REVIEW_REQUIRED', 'CANCELLED', 'EXPIRED']) {
    assert.equal(validateCheckout({ ...payable, status }, id, now).paymentUrl, null);
  }
  assert.equal(validateCheckout({ ...payable, expiresAt: '2026-10-25T00:00:00Z' }, id, now).paymentUrl, null);
  for (const value of [{ ...payable, id: 'b'.repeat(32) }, { ...payable, id: '../api/cart' },
    { ...payable, status: 'SUCCESS' }, { ...payable, expiresAt: 'tomorrow' },
    { ...payable, paymentUrl: 'https://evil.test/a' }]) assert.throws(() => validateCheckout(value, id, now));
});
test('problem mapping ignores arbitrary backend text and only uses bounded allowed codes', () => {
  assert.match(problemMessage('CREDIT_SUPPORT_REQUIRED'), /credit/i);
  assert.match(problemMessage('ZERO_PAYABLE_SUPPORT_REQUIRED'), /support/i);
  assert.doesNotMatch(problemMessage('private phone +919999999999'), /9999|private/);
});
test('off flag and anonymous identity issue zero durable checkout calls', async () => {
  const { flow, calls } = fixture(undefined, false);
  await flow.load(); await flow.save(); await flow.prepare(); await flow.confirm(details); await flow.check();
  assert.equal(calls.length, 0);
  const anonymous = fixture(); anonymous.flow.setIdentity(null);
  await anonymous.flow.load(); await anonymous.flow.save();
  assert.equal(anonymous.calls.length, 0);
});
test('login does not fetch/merge/overwrite; explicit load replaces view only; explicit save uses exact version', async () => {
  const { flow, calls } = fixture();
  assert.equal(calls.length, 0);
  await flow.load();
  assert.equal(calls.length, 1);
  assert.equal(flow.state.cart.version, 1);
  await flow.save();
  assert.deepEqual(calls.at(-1).body, { version: 1, ...basket });
  assert.equal(calls.at(-1).method, 'PUT');
});
test('first explicit Save replaces retired server IDs using returned version and only the local snapshot', async () => {
  const { flow, calls, local } = fixture(undefined, true, retiredCart);
  let loaded = 0; flow.onBasket = () => loaded++;
  assert.equal(calls.length, 0);
  await flow.save();
  assert.deepEqual(calls.map(c => [c.path, c.method]), [['/api/cart', undefined], ['/api/cart', 'PUT']]);
  assert.deepEqual(calls[1].body, { version: 12, ...basket });
  assert.deepEqual(local, basket);
  assert.equal(loaded, 0);
  assert.equal(flow.state.cart.version, 13);
  assert.deepEqual(flow.state.cart.lines, basket.lines);
  assert.equal(flow.state.dirty, false);
});
test('first Save snapshots chosen local lines before fetching the retired account version', async () => {
  const { flow, calls } = fixture(undefined, true, retiredCart);
  const local = structuredClone(basket);
  flow.getBasket = () => local;
  const original = flow.api.request;
  let release;
  flow.api.request = (path, body, signal, method) => method === 'PUT' ? original(path, body, signal, method) :
    new Promise(resolve => { release = resolve; });
  const pending = flow.save();
  await new Promise(resolve => setImmediate(resolve));
  local.lines[0].quantity = 9; local.date = '2026-11-03';
  release(structuredClone(retiredCart));
  await pending;
  assert.deepEqual(calls.at(-1).body, { version: 12, ...basket });
});
test('Load with mixed retired/current lines preserves ALL local edits and requires explicit replacement Save', async () => {
  const { flow, calls, local } = fixture(undefined, true, retiredCart);
  let loaded = 0; flow.onBasket = () => loaded++;
  await flow.load();
  assert.equal(loaded, 0);
  assert.deepEqual(local, basket);
  assert.deepEqual(flow.state.cart.lines, retiredCart.lines);
  assert.equal(flow.state.cart.version, 12);
  assert.equal(flow.state.dirty, true);
  assert.equal(flow.state.needsReload, false);
  assert.match(flow.state.message, /unavailable.*not loaded/i);
  assert.match(flow.state.message, /entire local basket is unchanged/i);
  assert.doesNotMatch(flow.state.message, /private backend text/);
  await flow.prepare(); await flow.confirm(details);
  assert.equal(calls.length, 1); // Loading never saves, prepares, or submits.
  await flow.save();
  assert.equal(calls.length, 2); // Reuses explicitly loaded version, no automatic GET/merge.
  assert.deepEqual(calls[1].body, { version: 12, ...basket });
  assert.equal(flow.state.dirty, false);
});
test('unavailable account Load does not silently clear an empty or different local basket/date', async () => {
  for (const local of [{ lines: [], date: '' }, { lines: [{ itemId: 1, quantity: 7 }], date: '2026-11-03' }]) {
    const { flow, calls } = fixture(undefined, true, { ...retiredCart, date: null });
    flow.getBasket = () => local;
    const original = flow.api.request;
    flow.api.request = async (...args) => {
      const value = await original(...args);
      if (args[3] !== 'PUT') return value;
      const subtotal = local.lines.reduce((sum, line) => sum + line.quantity * 20, 0);
      return { ...value, quote: { ...quote, date: local.date || null, valid: Boolean(local.lines.length && local.date),
        lines: local.lines.map(line => ({ ...line, name: 'Bread', unitPrice: 20, lineTotal: line.quantity * 20 })),
        listSubtotal: subtotal, totalAmount: subtotal + 50 } };
    };
    let loaded = 0; flow.onBasket = () => loaded++;
    await flow.load();
    assert.equal(loaded, 0);
    assert.deepEqual(flow.getBasket(), local);
    await flow.save();
    assert.deepEqual(calls.at(-1).body, { version: 12, lines: local.lines, date: local.date || null });
    assert.equal(flow.state.cart.version, 13);
    assert.equal(flow.state.dirty, false);
  }
});
test('retired account recovery never permits unknown outgoing IDs or writes after malformed GET', async () => {
  const invalidLocal = fixture(undefined, true, retiredCart);
  invalidLocal.flow.getBasket = () => ({ ...basket, lines: [{ itemId: 99, quantity: 1 }] });
  await invalidLocal.flow.save();
  assert.equal(invalidLocal.calls.length, 1);
  assert.equal(invalidLocal.flow.state.cart, null);
  for (const malformed of [{ ...retiredCart, version: '12' },
    { ...retiredCart, lines: [{ itemId: 99, quantity: 0 }] }]) {
    const { flow, calls } = fixture(undefined, true, malformed);
    let loaded = 0; flow.onBasket = () => loaded++;
    await flow.load(); await flow.save();
    assert.equal(loaded, 0);
    assert.equal(flow.state.cart, null);
    assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  }
});
test('retired basket replacement conflict still requires explicit Load and then a separate explicit Save', async () => {
  const { flow, calls, local } = fixture(undefined, true, retiredCart);
  const original = flow.api.request;
  let conflict = true;
  flow.api.request = async (...args) => {
    if (args[3] === 'PUT' && conflict) {
      calls.push({ path: args[0], method: 'PUT', body: structuredClone(args[1]) });
      throw Object.assign(new Error(), { status: 409, code: 'CART_CONFLICT' });
    }
    const value = await original(...args);
    return args[3] === 'PUT' ? value : { ...value, version: 14 };
  };
  await flow.save();
  assert.equal(flow.state.needsReload, true);
  const count = calls.length;
  await flow.save(); await flow.prepare();
  assert.equal(calls.length, count);
  await flow.load();
  assert.equal(calls.length, count + 1);
  assert.equal(flow.state.needsReload, false);
  assert.equal(flow.state.dirty, true);
  assert.equal(flow.state.cart.version, 14);
  assert.deepEqual(local, basket);
  conflict = false;
  await flow.save();
  assert.deepEqual(calls.at(-1).body, { version: 14, ...basket });
  assert.equal(flow.state.cart.version, 15);
});
test('prepare, review, confirm are separate; exact immutable payload and same key on explicit uncertain retry', async () => {
  let count = 0;
  const { flow, calls } = fixture(() => { if (++count === 1) throw new TypeError('network'); return payable; });
  await flow.load(); await flow.prepare();
  assert.equal(calls.filter(c => c.path === '/api/checkout').length, 0);
  await flow.confirm(details);
  const attempt = flow.state.attempt;
  assert.ok(attempt);
  assert.ok(Object.isFrozen(attempt.payload));
  assert.equal(flow.state.ambiguous, true);
  await flow.confirm({ ...details, name: 'Changed' }); // Never new order or changed payload.
  assert.equal(count, 1);
  await flow.retry();
  const posts = calls.filter(c => c.path === '/api/checkout');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, posts[1].body);
  assert.deepEqual(Object.keys(posts[0].body).sort(), ['idempotencyKey', 'cartVersion', 'quoteToken', ...Object.keys(details)].sort());
  assert.equal(flow.state.result.status, 'PAYABLE');
  assert.ok(Object.isFrozen(flow.state.attempt.quote.lines[0]));
  assert.equal(flow.state.attempt.quote.totalAmount, 90);
});
test('concurrent confirm cannot send twice; late transport cannot restore state after logout', async () => {
  let resolve;
  const { flow, calls } = fixture(() => new Promise(r => { resolve = r; }));
  await flow.load(); await flow.prepare();
  const pending = flow.confirm(details);
  await new Promise(r => setImmediate(r));
  await flow.confirm(details);
  flow.setIdentity(null);
  resolve(payable); await pending;
  assert.equal(calls.filter(c => c.path === '/api/checkout').length, 1);
  assert.equal(flow.state.result, null);
  assert.equal(flow.state.attempt, null);
});
test('changed identity detected at bootstrap never sends acceptance', async () => {
  const { flow, calls } = fixture();
  await flow.load(); await flow.prepare();
  flow.api.session = async () => ({ ...session, customer: { id: 8 } });
  await flow.confirm(details);
  assert.equal(calls.filter(c => c.path === '/api/checkout').length, 0);
  assert.equal(flow.state.result, null);
});
test('cart edits and suspension clear quote/link immediately; explicit recovery retains original payload', async () => {
  const { flow } = fixture();
  await flow.load(); await flow.prepare(); await flow.confirm(details);
  const payload = flow.state.attempt.payload;
  for (const reason of ['offline', 'hidden', 'close', 'cart', 'cross-tab']) {
    flow.suspend(reason);
    assert.equal(flow.state.prepared, null);
    assert.equal(flow.state.result, null);
    assert.equal(flow.state.suspended, true);
    assert.equal(flow.state.attempt.payload, payload);
  }
  await flow.check();
  assert.equal(flow.state.result.id, id);
});
test('409 conflict never blindly retries or reloads; explicit load alone consents to discard edits', async () => {
  const { flow, calls } = fixture();
  await flow.load();
  const original = flow.api.request;
  flow.api.request = async (...args) => {
    if (args[3] === 'PUT') { calls.push({ path: args[0] }); throw Object.assign(new Error(), { status: 409, code: 'CART_CONFLICT' }); }
    return original(...args);
  };
  await flow.save();
  const count = calls.length;
  assert.equal(flow.state.needsReload, true);
  await flow.save(); await flow.prepare();
  assert.equal(calls.length, count);
  await flow.load();
  assert.equal(flow.state.needsReload, false);
});
test('credit-applied and zero quotes cannot create an attempt; hidden credit balance rejection maps support', async () => {
  for (const values of [{ creditApplied: 1 }, { totalAmount: 0 }]) {
    const { flow, calls } = fixture();
    await flow.load();
    const original = flow.api.request;
    flow.api.request = (path, ...args) => path === '/api/checkout/prepare' ?
      Promise.resolve({ ...prepared, quote: { ...quote, ...values } }) : original(path, ...args);
    await flow.prepare(); await flow.confirm(details);
    assert.equal(calls.filter(c => c.path === '/api/checkout').length, 0);
    assert.match(flow.state.message, /support|credit/i);
  }
  const { flow } = fixture(() => { throw Object.assign(new Error('secret'), { status: 409, code: 'CREDIT_SUPPORT_REQUIRED' }); });
  await flow.load(); await flow.prepare(); await flow.confirm(details);
  assert.match(flow.state.message, /credit/i);
  assert.equal(flow.state.ambiguous, false);
});
test('owned UNKNOWN never retries acceptance; polling is bounded and status cannot change opaque ID', async () => {
  const { flow, calls } = fixture(() => ({ ...payable, status: 'UNKNOWN', paymentUrl: null }));
  await flow.load(); await flow.prepare(); await flow.confirm(details);
  await flow.retry();
  for (let i = 0; i < 20; i++) await flow.poll();
  assert.equal(calls.filter(c => c.path === '/api/checkout').length, 1);
  assert.equal(calls.filter(c => c.path === `/api/checkout/${id}`).length, 10);
  flow.suspend('hidden'); await flow.poll();
  assert.equal(calls.filter(c => c.path === `/api/checkout/${id}`).length, 10);
  assert.match(flow.state.message, /support|paused/i);
});
test('checkout API routes require enabled client, exact methods, opaque IDs, bootstrap and safe codes', async () => {
  const calls = [];
  const api = new StorefrontApi(async (path, options) => {
    calls.push({ path, options });
    return { ok: false, status: 409, json: async () => ({ problems: [{ code: 'QUOTE_EXPIRED', message: 'private' }] }) };
  }, { checkoutEnabled: true });
  api.useSession(session);
  await assert.rejects(api.request('/api/cart', { version: 0, ...basket }, undefined, 'PUT'), e => e.code === 'QUOTE_EXPIRED' && !e.message.includes('private'));
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.headers['X-XSRF-TOKEN'], 'csrf');
  await assert.rejects(api.request(`/api/checkout/${id}`));
  for (const path of [`/api/checkout/${id}?x=1`, '/api/checkout/../cart', '/api/checkout/x', `/api/checkout/${id}/extra`, '/api/cart?customer=1']) {
    const before = calls.length; await assert.rejects(api.request(path)); assert.equal(calls.length, before);
  }
  const before = calls.length;
  await assert.rejects(api.request('/api/cart', {}, undefined, 'POST'));
  assert.equal(calls.length, before);
});

test('ambiguous retry preserves original payload if bootstrap itself fails; failed quote is not redisplayed', async () => {
  const { flow, calls } = fixture(() => { throw new TypeError('lost response'); });
  await flow.load(); await flow.prepare(); await flow.confirm(details);
  const original = flow.state.attempt.payload;
  flow.api.session = async () => { throw new TypeError('offline'); };
  await flow.retry();
  assert.equal(flow.state.attempt.payload, original);
  assert.equal(flow.state.ambiguous, true);
  assert.equal(flow.state.dirty, true);
  assert.equal(calls.filter(c => c.path === '/api/checkout').length, 1);
  await flow.confirm(details);
  assert.equal(flow.state.attempt.payload, original);
});

test('checkout bootstrap identity mismatch notifies outer preview invalidation immediately', async () => {
  const { flow } = fixture();
  let lost = 0;
  flow.onIdentityLost = () => lost++;
  flow.api.session = async () => ({ ...session, customer: { id: 99 } });
  await flow.load();
  assert.equal(lost, 1);
  assert.equal(flow.identity, null);
  assert.equal(flow.state.cart, null);
});

test('prepare conflict marks previous account quote stale and requires fresh explicit load', async () => {
  const { flow } = fixture();
  await flow.load();
  flow.api.request = async () => { throw Object.assign(new Error('private'), { status: 409, code: 'QUOTE_CHANGED' }); };
  await flow.prepare();
  assert.equal(flow.state.dirty, true);
  assert.equal(flow.state.prepared, null);
  assert.doesNotMatch(flow.state.message, /private/);
});

test('UNKNOWN and REVIEW_REQUIRED stay support states beyond payment expiry, never paid or new order', () => {
  for (const status of ['UNKNOWN', 'REVIEW_REQUIRED']) {
    const value = validateCheckout({ ...payable, status, expiresAt: '2026-10-25T00:00:00Z' }, id, now);
    assert.equal(value.status, status);
    assert.equal(value.paymentUrl, null);
  }
});

test('cart edit during prepare rejects a late success even if transport ignores abort', async () => {
  const { flow } = fixture(); await flow.load();
  let release;
  flow.api.request = () => new Promise(resolve => { release = resolve; });
  const pending = flow.prepare(); await new Promise(r => setImmediate(r));
  flow.changed(); release(prepared); await pending;
  assert.equal(flow.state.prepared, null);
  assert.equal(flow.state.dirty, true);
  assert.equal(flow.state.busy, false);
});

test('status response for a different opaque ID never exposes a payment URL', async () => {
  const { flow } = fixture(); await flow.load(); await flow.prepare(); await flow.confirm(details);
  flow.api.request = async () => ({ ...payable, id: 'b'.repeat(32) });
  await flow.check();
  assert.equal(flow.state.result, null);
  assert.equal(flow.state.attempt.id, id);
});

test('all durable routes remain disallowed without independent client opt-in', async () => {
  let calls = 0;
  const api = new StorefrontApi(async () => { calls++; }); api.useSession(session);
  for (const path of ['/api/cart', '/api/checkout/prepare', '/api/checkout', `/api/checkout/${id}`]) {
    await assert.rejects(api.request(path));
  }
  assert.equal(calls, 0);
});

test('mock DOM checkout is usable through save/prepare/review/confirm/payment/status and immediately hides on pause', async () => {
  const originalDocument = globalThis.document;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const nodes = [];
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; this.value = ''; nodes.push(this); }
    append(...nodes) { this.children.push(...nodes); }
    after(node) { this.sibling = node; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; if (key === 'href') delete this.href; }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
    async fire(type) { for (const callback of this.events[type] || []) await callback({ preventDefault() {} }); }
  }
  let checkout;
  try {
    const authHelp = new Node('p'); const disclaimer = new Node('p');
    const select = id => nodes.find(node => node.id === id);
    globalThis.document = { hidden: false, createElement: tag => new Node(tag),
      querySelector: selector => selector === '#sf-auth .sf-note' ? authHelp : selector === '#sf-disclaimer' ? disclaimer : null };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    const calls = [];
    const api = { session: async () => session, request: async (path, body, _signal, method) => {
      calls.push({ path, body, method });
      if (path === '/api/cart') return structuredClone(cart);
      if (path === '/api/checkout/prepare') return { ...structuredClone(prepared), expiresAt: new Date(Date.now() + 600000).toISOString() };
      return { ...payable, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    } };
    checkout = attachCheckout({ api, ui: { auth: new Node('section'), dialog: { open: true } },
      allowedIds: ids, getBasket: () => basket, onBasket: () => {} });
    checkout.identity(7);
    assert.equal(calls.length, 0);
    assert.equal(select('sf-checkout').attributes['aria-labelledby'], 'sf-checkout-title');
    assert.equal(select('sf-confirm-pay').hidden, true);
    await select('sf-cart-load').fire('click');
    assert.equal(select('sf-prepare').disabled, false);
    await select('sf-prepare').fire('click');
    assert.equal(select('sf-delivery').hidden, false);
    assert.equal(select('sf-confirm-pay').hidden, true);
    select('sf-delivery-name').value = details.name;
    select('sf-delivery-address').value = details.address;
    select('sf-delivery-preference').value = details.deliveryPreference;
    select('sf-loaf-preference').value = details.loafPreference;
    await select('sf-delivery').fire('submit');
    assert.equal(select('sf-delivery').hidden, true);
    assert.equal(select('sf-confirm-pay').hidden, false);
    select('sf-delivery-name').value = 'Mutated hidden field';
    await select('sf-confirm-pay').fire('click');
    assert.equal(calls.find(call => call.path === '/api/checkout').body.name, details.name);
    assert.equal(select('sf-payment-link').href, payable.paymentUrl);
    assert.equal(select('sf-payment-link').target, '_blank');
    assert.equal(checkout.flow.state.result.status, 'PAYABLE');
    await select('sf-checkout-refresh').fire('click');
    assert.equal(calls.at(-1).path, `/api/checkout/${id}`);
    checkout.changed();
    assert.equal(select('sf-checkout-quote').children.length, 0);
    assert.equal(select('sf-payment-link').href, undefined);
    await select('sf-checkout-refresh').fire('click');
    assert.equal(select('sf-checkout-quote').children[0].textContent, 'Accepted checkout quote — original order');
    assert.match(select('sf-accepted-details').children[0].textContent, /Original checkout delivery/);
    assert.equal(checkout.flow.state.attempt.quote.totalAmount, 90);
    checkout.suspend('offline');
    assert.equal(select('sf-payment-link').hidden, true);
    assert.equal(select('sf-payment-link').href, undefined);
    assert.equal(select('sf-checkout-quote').children.length, 0);
    assert.equal(select('sf-accepted-details').children.length, 0);
    assert.equal(select('sf-delivery-name').value, '');
    checkout.identity(null);
    assert.equal(checkout.flow.state.attempt, null);
    // A structurally valid but unrenderable account basket must not clear the
    // local basket, enable Prepare, or hide the explicit replacement choice.
    let loaded = 0;
    checkout.flow.onBasket = () => loaded++;
    api.request = async (path, body, _signal, method) => {
      calls.push({ path, body, method });
      return structuredClone(retiredCart);
    };
    checkout.identity(7);
    await select('sf-cart-load').fire('click');
    assert.equal(loaded, 0);
    assert.equal(select('sf-cart-save').disabled, false);
    assert.equal(select('sf-cart-load').disabled, false);
    assert.equal(select('sf-prepare').disabled, true);
    assert.equal(select('sf-confirm-pay').hidden, true);
    assert.equal(select('sf-payment-link').href, undefined);
    assert.match(select('sf-checkout-status').textContent, /unavailable.*not loaded/i);
    assert.match(select('sf-checkout-status').textContent, /Choose Save this basket/i);
    assert.equal(select('sf-checkout-quote').children.length, 1);
    assert.doesNotMatch(select('sf-checkout-quote').children[0].textContent, /private backend text/);
  } finally {
    checkout?.suspend('test complete');
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
  }
});