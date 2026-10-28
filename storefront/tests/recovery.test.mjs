import test from 'node:test';
import assert from 'node:assert/strict';
import { CheckoutFlow } from '../checkout-flow.mjs';

const now = Date.parse('2026-10-27T08:00:00Z');
const id = 'r'.repeat(32);
const session = { authenticated: true, customer: { id: 7 } };
const details = { name: 'Original customer', address: '123 Historical Street, Gurugram',
  deliveryPreference: 'GATE', loafPreference: 'SLICED' };
const profile = { version: 3, name: 'Saved customer', address: '456 Saved Street, Gurugram',
  deliveryPreference: 'DOOR', loafPreference: 'WHOLE' };
const basket = { lines: [{ itemId: 1, quantity: 3 }], date: '2026-11-03' };
const quoteFor = (value, name, price) => ({ valid: true, date: value.date,
  lines: value.lines.map(line => ({ ...line, name, unitPrice: price, lineTotal: line.quantity * price })),
  problems: [], itemCount: value.lines.reduce((sum, line) => sum + line.quantity, 0),
  listSubtotal: value.lines.reduce((sum, line) => sum + line.quantity * price, 0),
  discountAmount: 0, discountLabel: null, batchDiscountAmount: 0, batchDiscountLabel: null,
  giftLabel: null, deliveryCharge: 50, creditApplied: 0,
  totalAmount: value.lines.reduce((sum, line) => sum + line.quantity * price, 50) });
const historicalQuote = quoteFor({ lines: [{ itemId: 99, quantity: 2 }], date: '2026-11-01' }, 'Retired historical bake', 35);
const liveQuote = quoteFor(basket, 'Current bake', 20);
const cart = { version: 8, ...basket, quote: liveQuote, problems: [] };
const historical = (status = 'PAYABLE') => ({ id, orderNumber: 'WEB-1027', createdAt: '2026-10-26T07:00:00Z',
  orderStatus: 'CONFIRMED', status, expiresAt: '2026-11-01T08:00:00Z',
  paymentUrl: status === 'PAYABLE' ? 'https://rzp.io/i/historical' : null,
  fulfillment: structuredClone(details), quote: structuredClone(historicalQuote) });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(recovered = historical()) {
  const calls = [], defaults = [], replacements = [];
  let local = structuredClone(basket), active = true, keys = 0;
  const api = {
    async session(signal) { calls.push({ path: 'session', signal }); return session; },
    async request(path, body, signal, method) {
      calls.push({ path, body: structuredClone(body), signal, method });
      if (path === '/api/account/checkout') return { checkout: structuredClone(recovered) };
      if (path === '/api/account/profile') return structuredClone(profile);
      if (path === `/api/account/orders/${id}`) return historical();
      if (path === '/api/cart') return structuredClone(cart);
      if (path === '/api/checkout/prepare') return { cartVersion: cart.version, quote: structuredClone(liveQuote),
        quoteToken: 't'.repeat(43), expiresAt: new Date(now + 600000).toISOString() };
      if (path === '/api/checkout') return historical();
      throw new Error(`Unexpected request ${path}`);
    }
  };
  const flow = new CheckoutFlow({ api, enabled: true, accountEnabled: true, allowedIds: new Set([1]),
    now: () => now, uuid: () => { keys++; return '12345678-1234-4234-8234-123456789abc'; },
    getBasket: () => local, onBasket: value => { replacements.push(value); local = value; },
    onDefaults: value => defaults.push(value), isActive: () => active });
  flow.setIdentity(7);
  return { flow, api, calls, defaults, replacements,
    get local() { return local; }, get keys() { return keys; },
    set local(value) { local = structuredClone(value); }, set active(value) { active = value; },
    requests() { return calls.filter(call => call.path !== 'session'); }
  };
}

test('account GET recovery restores immutable historical quote and fulfillment, never POST or current catalogue', async () => {
  const f = fixture();
  assert.equal(f.flow.recoveryReady, false);
  await f.flow.prepare();
  assert.equal(f.calls.length, 0);
  await f.flow.resume();
  assert.deepEqual(f.requests().map(call => call.path), ['/api/account/checkout', '/api/account/profile']);
  assert.equal(f.requests().every(call => call.body === undefined && call.method === undefined), true);
  assert.equal(f.flow.recoveryReady, true);
  assert.equal(f.flow.state.attempt.recovered, true);
  assert.equal(f.flow.state.attempt.id, id);
  assert.deepEqual(f.flow.state.attempt.payload, details);
  assert.deepEqual(f.flow.state.attempt.quote, historicalQuote);
  assert.equal(f.flow.state.attempt.quote.lines[0].itemId, 99); // Deliberately outside allowedIds.
  assert.equal(Object.isFrozen(f.flow.state.attempt.payload), true);
  assert.equal(Object.isFrozen(f.flow.state.attempt.quote.lines[0]), true);
  assert.equal(f.flow.state.result.paymentUrl, historical().paymentUrl);
  assert.deepEqual(f.local, basket);
  assert.equal(f.replacements.length, 0);
  await f.flow.confirm(details); await f.flow.retry(); await f.flow.prepare();
  assert.equal(f.keys, 0);
  assert.equal(f.requests().length, 2);
});

test('PAYABLE recovery polls the owned account detail with GET at most ten times and never submits', async () => {
  const f = fixture(); await f.flow.resume();
  for (let i = 0; i < 25; i++) await f.flow.poll();
  const owned = f.requests().filter(call => call.path === `/api/account/orders/${id}`);
  assert.equal(owned.length, 10);
  assert.equal(f.flow.polls, 10);
  assert.equal(owned.every(call => call.body === undefined && call.method === undefined), true);
  assert.equal(f.requests().some(call => call.path.startsWith('/api/checkout')), false);
  assert.equal(f.flow.state.result.status, 'PAYABLE');
  const count = f.calls.length;
  f.active = false; f.flow.suspend('hidden');
  await f.flow.poll(); await f.flow.check(); await f.flow.resume();
  assert.equal(f.calls.length, count);
  assert.equal(f.flow.state.result, null);
  assert.equal(f.flow.state.attempt.payload, null);
});

test('owned recovery status rejects a response for another opaque ID without exposing its link', async () => {
  const f = fixture(); await f.flow.resume();
  const original = f.api.request;
  f.api.request = async (...args) => {
    const value = await original(...args);
    return args[0] === `/api/account/orders/${id}` ? { ...value, id: 'x'.repeat(32) } : value;
  };
  await f.flow.check();
  assert.equal(f.flow.state.result, null);
  assert.equal(f.flow.state.attempt.id, id);
  assert.equal(f.requests().at(-1).path, `/api/account/orders/${id}`);
});

for (const path of ['/api/account/checkout', `/api/account/orders/${id}`, '/api/account/profile']) {
  for (const reason of ['hidden', 'offline', 'identity']) {
    test(`${reason} aborts ${path} and ignores a late private response even if transport ignores abort`, async () => {
      const f = fixture(path === '/api/account/profile' ? null : historical());
      if (path.startsWith('/api/account/orders/')) await f.flow.resume();
      const reply = deferred(), started = deferred(), original = f.api.request;
      f.api.request = async (...args) => {
        const value = await original(...args);
        if (args[0] === path) { started.resolve(); await reply.promise; }
        return value;
      };
      const pending = path.startsWith('/api/account/orders/') ? f.flow.check() : f.flow.resume();
      await started.promise;
      const request = f.requests().at(-1), defaultsBefore = f.defaults.length;
      if (reason === 'identity') f.flow.setIdentity(8);
      else { f.active = false; f.flow.suspend(reason); }
      assert.equal(request.signal.aborted, true);
      reply.resolve(); await pending;
      assert.equal(f.flow.state.result, null);
      assert.equal(f.flow.state.prepared, null);
      assert.equal(f.defaults.length, defaultsBefore);
      if (reason === 'identity') assert.equal(f.flow.state.attempt, null);
      else if (f.flow.state.attempt) assert.equal(f.flow.state.attempt.payload, null);
      f.active = false;
      const count = f.calls.length;
      await f.flow.resume(); await f.flow.check(); await f.flow.poll(); await f.flow.retry();
      assert.equal(f.calls.length, count);
    });
  }
}

test('identity change during bootstrap aborts before recovery GET and cannot restore old defaults', async () => {
  const f = fixture(), started = deferred(), reply = deferred();
  f.api.session = async signal => { f.calls.push({ path: 'session', signal }); started.resolve(); return reply.promise; };
  const pending = f.flow.resume(); await started.promise;
  f.flow.setIdentity(8);
  assert.equal(f.calls[0].signal.aborted, true);
  reply.resolve(session); await pending;
  assert.equal(f.requests().length, 0);
  assert.equal(f.defaults.length, 0);
  assert.equal(f.flow.identity, 8);
});

test('ambiguous acceptance retains its original payload for explicit retry, never fabricates GET recovery', async () => {
  const f = fixture(null); await f.flow.resume(); await f.flow.load(); await f.flow.prepare();
  const original = f.api.request;
  let sent = 0;
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (args[0] === '/api/checkout' && ++sent === 1) throw new TypeError('lost acknowledgement');
    return value;
  };
  await f.flow.confirm(details);
  const payload = f.flow.state.attempt.payload;
  assert.equal(f.flow.state.ambiguous, true);
  assert.equal(f.flow.state.attempt.id, null);
  assert.equal(Object.isFrozen(payload), true);
  assert.deepEqual(payload, { idempotencyKey: '12345678-1234-4234-8234-123456789abc',
    cartVersion: 8, quoteToken: 't'.repeat(43), ...details });
  f.local = { ...basket, lines: [{ itemId: 1, quantity: 8 }] };
  f.flow.changed(); f.flow.suspend('hidden');
  const count = f.calls.length;
  await f.flow.resume(); await f.flow.poll(); await f.flow.check();
  await f.flow.confirm({ ...details, name: 'Later edit' }); await f.flow.prepare();
  assert.equal(f.calls.length, count);
  assert.equal(f.flow.state.attempt.payload, payload);
  assert.equal(f.flow.state.result, null);
  await f.flow.retry();
  const posts = f.requests().filter(call => call.path === '/api/checkout');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, posts[1].body);
  assert.equal(f.keys, 1);
  assert.equal(f.flow.state.attempt.id, id);
  assert.equal(f.flow.state.ambiguous, false);
  assert.equal(f.requests().filter(call => call.path === '/api/account/checkout').length, 1);
});

test('two prebootstrapped tabs recover the actual owned ID after a definitive fresh rejection, never resend', async () => {
  const a = fixture(null), b = fixture(null);
  for (const f of [a, b]) { await f.flow.resume(); await f.flow.load(); await f.flow.prepare(); }
  await a.flow.confirm(details);
  const original = b.api.request;
  b.api.request = async (...args) => {
    const value = await original(...args);
    if (args[0] === '/api/checkout') throw Object.assign(new Error(), { status: 409, code: 'CHECKOUT_IN_PROGRESS' });
    if (args[0] === '/api/account/checkout') return { checkout: historical() };
    return value;
  };
  const count = b.requests().length;
  await b.flow.confirm({ ...details, name: 'Rejected tab B snapshot' });
  const recovery = b.requests().slice(count);
  assert.deepEqual(recovery.map(call => call.path), ['/api/checkout', '/api/account/checkout']);
  assert.equal(recovery[1].body, undefined);
  assert.equal(recovery[1].method, undefined); // Exact GET, no acceptance retry.
  assert.equal(b.flow.state.attempt.id, a.flow.state.attempt.id);
  assert.equal(b.flow.state.attempt.id, id);
  assert.equal(b.flow.state.attempt.recovered, true);
  assert.deepEqual(b.flow.state.attempt.payload, details);
  assert.deepEqual(b.flow.state.attempt.quote, historicalQuote);
  assert.equal(b.flow.state.ambiguous, false);
  assert.equal(b.flow.state.busy, false);
  assert.deepEqual(b.local, basket);
  await b.flow.retry(); await b.flow.confirm(details);
  assert.equal(b.requests().length, count + 2);
  assert.equal(b.keys, 1);
});

test('failed GET after a fresh rejection blocks new preparation until explicit recovery succeeds', async () => {
  const f = fixture(null); await f.flow.resume(); await f.flow.load(); await f.flow.prepare();
  const original = f.api.request;
  let offline = true;
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (args[0] === '/api/checkout') throw Object.assign(new Error(), { status: 409, code: 'CHECKOUT_IN_PROGRESS' });
    if (args[0] === '/api/account/checkout') {
      if (offline) throw new TypeError('offline');
      return { checkout: historical() };
    }
    return value;
  };
  await f.flow.confirm(details);
  assert.equal(f.flow.state.attempt, null);
  assert.equal(f.flow.recoveryReady, false);
  const count = f.requests().length;
  await f.flow.prepare(); await f.flow.retry(); await f.flow.confirm(details);
  assert.equal(f.requests().length, count);
  offline = false; await f.flow.resume();
  assert.equal(f.flow.state.attempt.id, id);
  assert.equal(f.requests().filter(call => call.path === '/api/checkout').length, 1);
});

test('a conflict on explicit retry cannot discard an uncertain original payload or key', async () => {
  const f = fixture(null); await f.flow.resume(); await f.flow.load(); await f.flow.prepare();
  const original = f.api.request;
  let sends = 0;
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (args[0] === '/api/checkout') {
      if (++sends === 1) throw new TypeError('lost acknowledgement');
      if (sends === 2) throw Object.assign(new Error(), { status: 409, code: 'CHECKOUT_IN_PROGRESS' });
    }
    return value;
  };
  await f.flow.confirm(details);
  const attempt = f.flow.state.attempt;
  await f.flow.retry();
  assert.equal(f.flow.state.attempt, attempt);
  assert.equal(f.flow.state.ambiguous, true);
  const count = f.requests().length;
  await f.flow.resume(); await f.flow.confirm(details); await f.flow.prepare();
  assert.equal(f.requests().length, count);
  await f.flow.retry();
  const posts = f.requests().filter(call => call.path === '/api/checkout');
  assert.equal(posts.length, 3);
  for (const post of posts) assert.deepEqual(post.body, attempt.payload);
  assert.equal(f.keys, 1);
  assert.equal(f.requests().filter(call => call.path === '/api/account/checkout').length, 1);
  assert.equal(f.flow.state.attempt.id, id);
});

test('historical PAID does not install an attempt or require dismissal and preserves a newer basket', async () => {
  const f = fixture(historical('PAID')); await f.flow.resume();
  const newer = { lines: [{ itemId: 1, quantity: 9 }], date: '2026-11-05' };
  f.local = newer;
  f.flow.state.cart = { ...cart, version: 10, ...structuredClone(newer), quote: null };
  f.flow.state.dirty = true;
  assert.equal(f.flow.state.result, null);
  assert.equal(f.flow.state.attempt, null);
  assert.equal(f.flow.recoveryReady, true);
  assert.equal(f.flow.canEditBasket, true);
  f.flow.startNewOrder();
  assert.equal(f.flow.state.attempt, null);
  assert.equal(f.flow.state.result, null);
  assert.equal(f.flow.state.cart.version, 10);
  assert.equal(f.flow.state.dirty, true);
  assert.deepEqual(f.local, newer);
  assert.equal(f.replacements.length, 0);
  await f.flow.resume(); // Server still returns that same paid historical order.
  assert.equal(f.flow.state.attempt, null);
  assert.equal(f.flow.state.result, null);
  assert.deepEqual(f.local, newer);
  assert.equal(f.requests().filter(call => call.path === '/api/account/checkout').length, 2);
  assert.equal(f.requests().some(call => call.path === '/api/checkout'), false);
});

test('active PAYABLE cannot be dismissed as a new order; a different recovered ID after dismissal is not ignored', async () => {
  const f = fixture(); await f.flow.resume();
  f.flow.startNewOrder(); assert.equal(f.flow.state.attempt.id, id);
  const original = f.api.request;
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (args[0] === `/api/account/orders/${id}`) return historical('PAID');
    if (args[0] === '/api/account/checkout') return { checkout: { ...historical(), id: 'n'.repeat(32) } };
    return value;
  };
  await f.flow.check(); f.flow.startNewOrder(); await f.flow.resume();
  assert.equal(f.flow.state.attempt.id, 'n'.repeat(32));
  assert.equal(f.flow.state.result.status, 'PAYABLE');
});

test('profile defaults callback runs once per identity; background resume never saves a profile or reapplies it', async () => {
  const f = fixture(null); await f.flow.resume();
  assert.deepEqual(f.defaults, [profile]);
  assert.equal(Object.isFrozen(f.defaults[0]), true);
  await f.flow.resume(); f.flow.suspend('hidden'); await f.flow.resume();
  assert.equal(f.defaults.length, 1);
  assert.equal(f.requests().filter(call => call.path === '/api/account/profile').length, 1);
  assert.equal(f.requests().every(call => call.body === undefined && call.method === undefined), true);
  f.flow.setIdentity(null); f.flow.setIdentity(7); await f.flow.resume();
  assert.equal(f.defaults.length, 2);
});

test('optional default failure cannot install historical paid checkout; a later GET can load suggestions', async () => {
  const f = fixture(historical('PAID'));
  const original = f.api.request;
  let unavailable = true;
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (args[0] === '/api/account/profile' && unavailable) throw new TypeError('offline defaults');
    if (args[0] === `/api/account/orders/${id}`) return historical('PAID');
    return value;
  };
  await f.flow.resume();
  assert.equal(f.flow.state.result, null);
  assert.equal(f.flow.state.attempt, null);
  assert.equal(f.flow.recoveryReady, true);
  assert.equal(f.flow.defaultsRead, false);
  unavailable = false; f.flow.suspend('page hidden'); await f.flow.resume();
  assert.equal(f.flow.state.result, null);
  assert.deepEqual(f.defaults, [profile]);
  assert.equal(f.requests().some(call => call.path === '/api/checkout'), false);
});

test('malformed recovery envelope or historical snapshot fails closed without POST or fabricated attempt', async () => {
  for (const value of [{ checkout: historical(), extra: true }, { checkout: { ...historical(), orderStatus: 'SUCCESS' } },
    { checkout: { ...historical(), quote: { ...historicalQuote, itemCount: 999 } } }]) {
    const f = fixture();
    f.api.request = async (path, body) => { f.calls.push({ path, body }); return value; };
    await f.flow.resume(); await f.flow.prepare(); await f.flow.retry();
    assert.equal(f.flow.recoveryReady, false);
    assert.equal(f.flow.state.attempt, null);
    assert.equal(f.flow.state.result, null);
    assert.equal(f.defaults.length, 0);
    assert.deepEqual(f.requests().map(call => call.path), ['/api/account/checkout']);
  }
});

for (const status of ['PAID', 'CANCELLED', 'EXPIRED']) {
  test(`historical ${status} permits fresh preparation without importing delivery or clearing current basket`, async () => {
    const f = fixture(historical(status)); await f.flow.resume();
    assert.equal(f.flow.state.attempt, null); assert.equal(f.flow.state.result, null);
    assert.equal(f.flow.recoveryReady, true); assert.equal(f.flow.canEditBasket, true);
    assert.deepEqual(f.local, basket); assert.equal(f.replacements.length, 0);
    await f.flow.load(); await f.flow.prepare();
    assert.equal(f.flow.state.prepared.cartVersion, cart.version);
    assert.deepEqual(f.flow.state.prepared.quote.lines, liveQuote.lines);
    assert.equal(f.flow.state.attempt, null);
    assert.equal(f.requests().some(call => call.path === '/api/checkout'), false);
    assert.equal(f.keys, 0);
  });
}

test('a current-page accepted PAID remains a compact receipt until explicit Continue, never automatically clears edits', async () => {
  const f = fixture(null); await f.flow.resume(); await f.flow.load(); await f.flow.prepare();
  const original = f.api.request;
  f.api.request = async (...args) => args[0] === '/api/checkout' ?
    (f.calls.push({ path: args[0], body: structuredClone(args[1]) }), historical('PAID')) : original(...args);
  await f.flow.confirm(details);
  assert.equal(f.flow.state.result.status, 'PAID'); assert.equal(f.flow.state.attempt.id, id);
  assert.match(f.flow.state.message, /Payment received/);
  assert.equal(f.flow.canEditBasket, true);
  const newer = { ...basket, lines: [{ itemId: 1, quantity: 9 }] }; f.local = newer;
  await f.flow.prepare(); await f.flow.confirm(details); await f.flow.poll();
  assert.equal(f.requests().filter(call => call.path === '/api/checkout').length, 1);
  assert.deepEqual(f.local, newer);
  f.flow.startNewOrder();
  assert.equal(f.flow.state.attempt, null); assert.equal(f.flow.state.result, null);
  assert.deepEqual(f.local, newer); assert.equal(f.replacements.length, 1, 'only explicit earlier Load replaced basket');
});

test('locally expired PAYABLE recovery keeps the pending fence until verified server termination', async () => {
  const expired = { ...historical(), expiresAt: new Date(now - 1).toISOString() };
  const f = fixture(expired), original = f.api.request;
  let server = expired;
  f.api.request = async (...args) => args[0] === `/api/account/orders/${id}` ?
    (f.calls.push({ path: args[0], body: args[1] }), structuredClone(server)) : original(...args);
  await f.flow.resume();
  assert.equal(f.flow.state.attempt.id, id);
  assert.equal(f.flow.state.result.status, 'PAYABLE', 'local deadline is not server termination');
  assert.equal(f.flow.state.result.paymentUrl, null);
  assert.match(f.flow.state.message, /link expired.*payment status/);
  assert.equal(f.flow.canEditBasket, false);
  assert.equal(f.flow.resolvedAttemptId, null);
  const count = f.requests().length;
  await f.flow.prepare(); await f.flow.confirm(details); f.flow.startNewOrder(); await f.flow.retry();
  assert.equal(f.requests().length, count);
  assert.equal(f.flow.state.attempt.id, id);
  for (let i = 0; i < 15; i++) await f.flow.poll();
  assert.equal(f.flow.polls, 10);
  assert.equal(f.flow.canEditBasket, false);
  assert.equal(f.flow.state.result.paymentUrl, null);
  server = { ...historical('EXPIRED'), expiresAt: expired.expiresAt };
  await f.flow.check();
  assert.equal(f.flow.state.result.status, 'EXPIRED');
  assert.equal(f.flow.canEditBasket, true);
  f.flow.startNewOrder();
  assert.equal(f.flow.state.attempt, null);
  assert.equal(f.requests().some(call => call.path === '/api/checkout'), false);
  assert.equal(f.keys, 0);
});

test('locally expired current-page acceptance and owned GET also retain the pending fence', async () => {
  const f = fixture(null); await f.flow.resume(); await f.flow.load(); await f.flow.prepare();
  const expired = { ...historical(), expiresAt: new Date(now - 1).toISOString() };
  const original = f.api.request;
  f.api.request = async (...args) => ['/api/checkout', `/api/checkout/${id}`].includes(args[0]) ?
    (f.calls.push({ path: args[0], body: structuredClone(args[1]) }), expired) : original(...args);
  await f.flow.confirm(details);
  assert.equal(f.flow.state.attempt.id, id);
  assert.equal(f.flow.state.result.status, 'PAYABLE');
  assert.equal(f.flow.state.result.paymentUrl, null);
  assert.equal(f.flow.canEditBasket, false);
  await f.flow.check(); f.flow.startNewOrder();
  assert.equal(f.flow.state.attempt.id, id);
  assert.equal(f.flow.resolvedAttemptId, null);
  assert.equal(f.flow.state.result.paymentUrl, null);
  assert.equal(f.requests().filter(call => call.path === '/api/checkout').length, 1);
});

test('fresh unchanged null recovery preserves the exact prepared quote, review and message', async () => {
  const f = fixture(null); await f.flow.resume(); await f.flow.load(); await f.flow.prepare();
  f.flow.review(details);
  const { prepared, review, message } = f.flow.state;
  f.flow.polls = 4;
  const count = f.requests().length;
  await f.flow.resume();
  assert.deepEqual(f.requests().slice(count).map(call => call.path), ['/api/account/checkout']);
  assert.equal(f.flow.state.prepared, prepared);
  assert.equal(f.flow.state.review, review);
  assert.equal(f.flow.state.message, message);
  assert.equal(f.flow.polls, 4);
  assert.equal(f.defaults.length, 1);
  assert.equal(f.flow.state.attempt, null);
  assert.equal(f.flow.state.dirty, false);
});

test('initial null then pending is recovered on visible resume with no overlapping recovery reads', async () => {
  const f = fixture(null); await f.flow.resume(); await f.flow.load(); await f.flow.prepare();
  f.flow.review(details);
  const original = f.api.request, started = deferred(), reply = deferred();
  let reads = 0;
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (args[0] !== '/api/account/checkout') return value;
    reads++; started.resolve(); await reply.promise;
    return { checkout: historical('UNKNOWN') };
  };
  const pending = f.flow.resume(); await started.promise;
  await Promise.all([f.flow.resume(), f.flow.resume(), f.flow.resume()]);
  assert.equal(reads, 1);
  assert.equal(f.flow.state.background, true);
  reply.resolve(); await pending;
  assert.equal(f.flow.state.attempt.id, id);
  assert.equal(f.flow.state.result.status, 'UNKNOWN');
  assert.equal(f.flow.state.prepared, null);
  assert.equal(f.flow.state.review, null);
  assert.equal(f.flow.canEditBasket, false);
  assert.equal(f.flow.state.busy, false);
  assert.equal(f.flow.state.background, false);
  assert.equal(f.requests().some(call => call.path === '/api/checkout'), false);
  assert.equal(f.keys, 0);
});