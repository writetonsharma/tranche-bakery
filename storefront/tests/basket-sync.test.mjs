import test from 'node:test';
import assert from 'node:assert/strict';
import { BasketSync, sameBasket } from '../basket-sync.mjs';
import { CheckoutFlow } from '../checkout-flow.mjs';

const now = Date.parse('2026-10-27T08:00:00Z');
const basket = { lines: [{ itemId: 1, quantity: 2 }], date: '2026-11-01' };
const session = { authenticated: true, customer: { id: 7 } };
const accountCart = (version = 4, value = basket) => ({ version, lines: structuredClone(value.lines),
  date: value.date || null, quote: null, problems: [] });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(local = basket, remote = accountCart()) {
  const calls = [], timers = new Map(), replacements = [];
  let device = structuredClone(local), active = true, timerId = 0, associations = 0, lost = 0;
  const api = {
    async session(signal) { calls.push({ path: 'session', signal }); return session; },
    async request(path, body, signal, method) {
      calls.push({ path, body: structuredClone(body), signal, method });
      return method === 'PUT' ? accountCart(body.version + 1, body) : structuredClone(remote);
    }
  };
  const sync = new BasketSync({ api, allowedIds: new Set([1, 2]), now: () => now,
    getBasket: () => device, onBasket: value => { replacements.push(value); device = value; },
    onAssociate: () => associations++, onIdentityLost: () => lost++, isActive: () => active,
    delay: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    cancel: id => timers.delete(id) });
  return { sync, api, calls, timers, replacements,
    get local() { return device; }, get associations() { return associations; }, get lost() { return lost; },
    set active(value) { active = value; },
    edit(value) { device = structuredClone(value); sync.changed(); },
    async tick() {
      const callbacks = [...timers.values()]; timers.clear();
      for (const callback of callbacks) await callback();
    },
    requests() { return calls.filter(call => call.path !== 'session'); }
  };
}

test('default timers retain global receiver through anonymous changes, identity pause, debounce and cancellation', async () => {
  const keys = ['setTimeout', 'clearTimeout'];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const timers = new Map(), calls = [];
  let timerId = 0, local = structuredClone(basket);
  const replacements = {
    setTimeout: function (callback, ms) {
      assert.equal(this, globalThis, 'native setTimeout rejects a BasketSync receiver');
      assert.equal(ms, 400);
      const key = ++timerId; timers.set(key, callback); return key;
    },
    clearTimeout: function (key) {
      assert.equal(this, globalThis, 'native clearTimeout rejects a BasketSync receiver');
      calls.push(key); timers.delete(key);
    }
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    // Deliberately omit delay/cancel: injected arrow fakes bypassed the defect.
    const sync = new BasketSync({ allowedIds: new Set([1]), now: () => now,
      getBasket: () => local, onBasket: value => { local = value; },
      api: { session: async () => session, request: async () => accountCart() } });
    assert.throws(() => globalThis.clearTimeout.call(sync, undefined), /native clearTimeout rejects/);
    assert.throws(() => globalThis.setTimeout.call(sync, () => {}, 400), /native setTimeout rejects/);
    sync.changed(); // Anonymous product click used to fail in schedule -> cancel.
    assert.equal(timers.size, 0);
    sync.setIdentity(7); // Signed-in startup used to fail in pause -> cancel.
    assert.ok(calls.includes(undefined), 'uninitialized timer cancellation is safe');
    await sync.refresh();
    sync.changed(); assert.equal(timers.size, 1);
    const first = sync.timer;
    sync.schedule(); assert.equal(timers.size, 1);
    assert.equal(timers.has(first), false, 'rescheduling cancels the previous debounce');
    sync.pause(); assert.equal(timers.size, 0);
    sync.schedule(); assert.equal(timers.size, 1);
    sync.setIdentity(null); assert.equal(timers.size, 0);
  } finally {
    timers.clear();
    keys.forEach((key, index) => {
      if (saved[index]) Object.defineProperty(globalThis, key, saved[index]); else delete globalThis[key];
    });
  }
  keys.forEach((key, index) => assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), saved[index]));
});

test('anonymous edits stay local; differing login baskets require a choice before any write', async () => {
  const device = { ...basket, lines: [{ itemId: 1, quantity: 5 }] };
  const f = fixture(device);
  f.sync.changed();
  await f.sync.refresh(); await f.sync.save(); await f.tick();
  assert.equal(f.calls.length, 0);
  f.sync.setIdentity(7);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.sync.refresh(), false);
  assert.equal(f.sync.state.choice, true);
  assert.equal(f.sync.state.associated, false);
  assert.deepEqual(f.local, device);
  assert.equal(f.replacements.length, 0);
  await f.sync.save(); await f.sync.refresh(); await f.tick();
  assert.equal(await f.sync.flush(), false);
  assert.deepEqual(f.requests().map(call => call.method), [undefined]);
  await f.sync.choose('merge');
  assert.equal(f.requests().length, 1);
  assert.equal(await f.sync.choose('device'), true);
  assert.deepEqual(f.requests().map(call => call.method), [undefined, undefined, 'PUT']);
  assert.deepEqual(f.requests().at(-1).body, { version: 4, ...device });
  assert.deepEqual(f.local, device);
  assert.equal(f.sync.state.cart.version, 5);
  assert.equal(f.sync.state.choice, false);
});

test('explicit account choice rereads and replaces the whole device basket, never merges or writes', async () => {
  const f = fixture({ lines: [{ itemId: 2, quantity: 8 }], date: '2026-11-03' });
  f.sync.setIdentity(7); await f.sync.refresh();
  const latest = { lines: [{ itemId: 1, quantity: 7 }], date: '2026-11-04' };
  const original = f.api.request;
  f.api.request = async (...args) => { await original(...args); return accountCart(9, latest); };
  assert.equal(await f.sync.choose('account'), true);
  assert.deepEqual(f.local, latest);
  assert.equal(f.sync.state.cart.version, 9);
  assert.equal(f.replacements.length, 1);
  assert.equal(f.requests().some(call => call.method === 'PUT'), false);
});

test('identical baskets autoassociate regardless of line order without replacing or writing', async () => {
  const local = { ...basket, lines: [...basket.lines, { itemId: 2, quantity: 1 }] };
  const remote = { ...local, lines: [...local.lines].reverse() };
  assert.equal(sameBasket(local, remote), true);
  assert.equal(sameBasket({ lines: [], date: '' }, { lines: [], date: null }), true);
  const f = fixture(local, accountCart(6, remote));
  f.sync.setIdentity(7);
  assert.equal(await f.sync.refresh(), true);
  assert.equal(f.sync.state.associated, true);
  assert.equal(f.associations, 1);
  assert.equal(f.replacements.length, 0);
  assert.equal(await f.sync.flush(), true);
  assert.equal(f.requests().length, 1);
});

test('an empty device automatically loads an available account basket without PUT', async () => {
  const f = fixture({ lines: [], date: '' });
  f.sync.setIdentity(7); await f.sync.refresh();
  assert.deepEqual(f.local, basket);
  assert.equal(f.replacements.length, 1);
  assert.equal(f.sync.state.choice, false);
  assert.equal(f.sync.state.associated, true);
  assert.deepEqual(f.requests().map(call => call.method), [undefined]);
});

test('unavailable account lines require choice and cannot be silently loaded or sent', async () => {
  const f = fixture(basket, accountCart(12, { ...basket, lines: [{ itemId: 99, quantity: 3 }] }));
  f.sync.setIdentity(7); await f.sync.refresh();
  assert.equal(f.sync.state.choice, true);
  assert.equal(await f.sync.choose('account'), false);
  assert.deepEqual(f.local, basket);
  assert.equal(f.replacements.length, 0);
  assert.equal(await f.sync.choose('device'), true);
  assert.deepEqual(f.requests().at(-1).body, { version: 12, ...basket });
});

test('edits during PUT keep the exact first snapshot and save newer edits with its acknowledged version', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  const first = { ...basket, lines: [{ itemId: 1, quantity: 3 }] };
  const newer = { lines: [{ itemId: 2, quantity: 4 }], date: '2026-11-03' };
  const reply = deferred(), started = deferred(), original = f.api.request;
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (args[3] === 'PUT' && args[1].version === 4) { started.resolve(); return reply.promise; }
    return value;
  };
  f.edit(first);
  const pending = f.sync.save(); await started.promise;
  f.edit(newer);
  assert.deepEqual(f.requests().at(-1).body, { version: 4, ...first });
  reply.resolve(accountCart(5, first));
  assert.equal(await pending, true);
  assert.equal(f.sync.state.dirty, true);
  assert.equal(f.sync.state.cart.version, 5);
  assert.deepEqual(f.local, newer);
  assert.equal(f.timers.size, 1);
  await f.tick();
  assert.deepEqual(f.requests().filter(call => call.method === 'PUT').map(call => call.body),
    [{ version: 4, ...first }, { version: 5, ...newer }]);
  assert.equal(f.sync.state.cart.version, 6);
  assert.equal(f.sync.state.dirty, false);
});

for (const kind of ['wrong version', 'wrong lines', 'wrong date', 'malformed', '409']) {
  test(`${kind} save acknowledgement preserves local edits and requires explicit choice, never retries`, async () => {
    const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
    const edit = { ...basket, lines: [{ itemId: 1, quantity: 6 }] };
    const original = f.api.request;
    f.api.request = async (...args) => {
      const value = await original(...args);
      if (args[3] !== 'PUT') return value;
      if (kind === '409') throw Object.assign(new Error('private backend text'), { status: 409 });
      if (kind === 'wrong version') return { ...value, version: value.version + 1 };
      if (kind === 'wrong lines') return accountCart(value.version, basket);
      if (kind === 'wrong date') return { ...value, date: '2026-11-02' };
      return { ...value, version: '5' };
    };
    f.edit(edit);
    assert.equal(await f.sync.save(), false);
    assert.equal(f.sync.state.choice, true);
    assert.equal(f.sync.state.dirty, true);
    assert.equal(f.sync.state.cart.version, 4);
    assert.deepEqual(f.local, edit);
    assert.doesNotMatch(f.sync.state.message, /private backend text/);
    const count = f.calls.length;
    f.sync.schedule(); await f.tick(); await f.sync.refresh(); await f.sync.save();
    assert.equal(await f.sync.flush(), false);
    assert.equal(f.calls.length, count);
    f.api.request = original;
    assert.equal(await f.sync.choose('device'), true);
    assert.equal(f.requests().filter(call => call.method === 'PUT').length, 2);
    assert.deepEqual(f.requests().at(-1).body, { version: 4, ...edit });
  });
}

test('device edits during initial GET reject stale auto-load and leave an explicit choice', async () => {
  const f = fixture({ lines: [], date: '' }), reply = deferred(), started = deferred();
  const original = f.api.request;
  f.api.request = async (...args) => { await original(...args); started.resolve(); return reply.promise; };
  f.sync.setIdentity(7);
  const pending = f.sync.refresh(); await started.promise;
  const edit = { ...basket, lines: [{ itemId: 2, quantity: 3 }] };
  f.edit(edit); reply.resolve(accountCart());
  assert.equal(await pending, false);
  assert.deepEqual(f.local, edit);
  assert.equal(f.replacements.length, 0);
  assert.equal(f.sync.state.choice, true);
  assert.equal(f.sync.state.dirty, true);
  await f.tick(); assert.equal(f.requests().length, 1);
});

test('edits before the initial account GET still load its version and offer reconciliation', async () => {
  const f = fixture({ lines: [], date: '' }); f.sync.setIdentity(7);
  const edit = { ...basket, lines: [{ itemId: 2, quantity: 4 }] };
  f.edit(edit);
  assert.equal(await f.sync.refresh(), false);
  assert.equal(f.sync.state.choice, true);
  assert.equal(f.sync.state.cart.version, 4);
  assert.deepEqual(f.local, edit);
  assert.equal(f.requests().some(call => call.method === 'PUT'), false);
  assert.equal(await f.sync.choose('device'), true);
  assert.deepEqual(f.requests().at(-1).body, { version: 4, ...edit });
});

for (const reason of ['hidden', 'offline', 'identity']) {
  test(`${reason} invalidates late GET even when transport ignores abort; inactive work makes no calls`, async () => {
    const f = fixture({ lines: [], date: '' }), reply = deferred(), started = deferred();
    const original = f.api.request;
    f.api.request = async (...args) => { await original(...args); started.resolve(); return reply.promise; };
    f.sync.setIdentity(7);
    const pending = f.sync.refresh(); await started.promise;
    const signal = f.requests()[0].signal;
    if (reason === 'identity') f.sync.setIdentity(8);
    else { f.active = false; f.sync.pause(); }
    assert.equal(signal.aborted, true);
    reply.resolve(accountCart()); await pending;
    assert.equal(f.sync.state.cart, null);
    assert.equal(f.sync.state.associated, false);
    assert.equal(f.replacements.length, 0);
    f.active = false;
    const count = f.calls.length;
    f.edit(basket); f.sync.schedule();
    await f.sync.refresh(); await f.sync.save(); await f.sync.choose('device'); await f.tick();
    assert.equal(await f.sync.flush(), false);
    assert.equal(f.calls.length, count);
  });
}

for (const reason of ['hidden', 'offline']) {
  test(`${reason} blocks clean refresh and dirty associated saves, including an already queued debounce`, async () => {
    const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
    const count = f.calls.length;
    f.active = false;
    assert.equal(await f.sync.refresh(), false);
    f.active = true;
    const edit = { ...basket, lines: [{ itemId: 1, quantity: 7 }] };
    f.edit(edit);
    assert.equal(f.timers.size, 1);
    f.active = false; // The callback must recheck activity even without pause cancelling it.
    await f.tick(); await f.sync.save();
    assert.equal(await f.sync.flush(), false);
    f.sync.schedule();
    assert.equal(f.timers.size, 0);
    assert.equal(f.calls.length, count);
    assert.equal(f.sync.state.dirty, true);
    assert.deepEqual(f.local, edit);
    f.active = true;
    assert.equal(await f.sync.flush(), true);
    assert.deepEqual(f.requests().at(-1).body, { version: 4, ...edit });
  });
}

test('a newer GET supersedes an aborted GET without accepting its late response', async () => {
  const f = fixture({ lines: [], date: '' }), reply = deferred(), started = deferred();
  const original = f.api.request;
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (f.requests().length === 1) { started.resolve(); return reply.promise; }
    return { ...value, version: 9 };
  };
  f.sync.setIdentity(7);
  const old = f.sync.refresh(); await started.promise;
  f.sync.pause(); await f.sync.refresh();
  reply.resolve(accountCart(4, { ...basket, lines: [{ itemId: 1, quantity: 9 }] })); await old;
  assert.equal(f.requests()[0].signal.aborted, true);
  assert.equal(f.sync.state.cart.version, 9);
  assert.deepEqual(f.local, basket);
  assert.equal(f.replacements.length, 1);
});

test('interrupted PUT retains edits and forces explicit reconciliation after reconnect, not automatic retry', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  const reply = deferred(), started = deferred(), original = f.api.request;
  f.api.request = async (...args) => { const value = await original(...args);
    if (args[3] === 'PUT') { started.resolve(); return reply.promise; } return value; };
  const edit = { ...basket, lines: [{ itemId: 1, quantity: 8 }] };
  f.edit(edit); const pending = f.sync.save(); await started.promise;
  f.active = false; f.sync.pause();
  assert.equal(f.requests().at(-1).signal.aborted, true);
  reply.resolve(accountCart(5, edit)); await pending;
  f.active = true;
  const count = f.calls.length;
  f.sync.schedule(); await f.tick(); await f.sync.refresh(); await f.sync.save();
  assert.equal(await f.sync.flush(), false);
  assert.equal(f.calls.length, count);
  assert.equal(f.sync.state.choice, true);
  assert.equal(f.sync.state.cart.version, 4);
  assert.deepEqual(f.local, edit);
});

test('associated account basket is removed on identity change and mismatched session prevents account reads', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  f.sync.setIdentity(8);
  assert.deepEqual(f.local, { lines: [], date: '' });
  assert.equal(f.sync.state.associated, false);
  const count = f.requests().length;
  await f.sync.refresh(); // Bootstrap still belongs to customer 7.
  assert.equal(f.requests().length, count);
  assert.equal(f.sync.identity, null);
  assert.equal(f.lost, 1);
});

test('prepare flushes an inflight save and newer edits before quoting the final acknowledged version', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  const reply = deferred(), started = deferred(), original = f.api.request;
  const flow = new CheckoutFlow({ api: f.api, enabled: true, allowedIds: new Set([1, 2]),
    now: () => now, getBasket: () => f.local, onBasket: () => {},
    beforePrepare: async () => {
      const ok = await f.sync.flush();
      flow.state.cart = f.sync.state.cart; flow.state.dirty = f.sync.state.dirty;
      return ok;
    } });
  flow.setIdentity(7);
  f.api.request = async (...args) => {
    if (args[0] === '/api/checkout/prepare') {
      f.calls.push({ path: args[0], body: structuredClone(args[1]), signal: args[2] });
      const value = f.sync.state.cart;
      return { cartVersion: value.version, quoteToken: 't'.repeat(43), expiresAt: new Date(now + 600000).toISOString(),
        quote: { valid: true, date: value.date, lines: value.lines.map(line => ({ ...line, name: 'Bread', unitPrice: 20, lineTotal: line.quantity * 20 })),
          problems: [], listSubtotal: 80, discountAmount: 0, batchDiscountAmount: 0, deliveryCharge: 50, creditApplied: 0, totalAmount: 130,
          discountLabel: null, batchDiscountLabel: null, giftLabel: null, itemCount: 4 } };
    }
    const value = await original(...args);
    if (args[3] === 'PUT' && args[1].version === 4) { started.resolve(); return reply.promise; }
    return value;
  };
  const first = { ...basket, lines: [{ itemId: 1, quantity: 3 }] };
  const newer = { ...basket, lines: [{ itemId: 1, quantity: 4 }] };
  f.edit(first); const saving = f.sync.save(); await started.promise;
  f.edit(newer); const preparing = flow.prepare();
  assert.equal(f.requests().some(call => call.path === '/api/checkout/prepare'), false);
  reply.resolve(accountCart(5, first)); await saving; await preparing;
  assert.deepEqual(f.requests().map(call => [call.path, call.body?.version ?? call.body?.cartVersion]),
    [['/api/cart', undefined], ['/api/cart', 4], ['/api/cart', 5], ['/api/checkout/prepare', 6]]);
  assert.equal(flow.state.prepared.cartVersion, 6);
  assert.equal(f.timers.size, 0);
  f.sync.pause();
});