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
const shopping = { dates: ['2026-11-01', '2026-11-03', '2026-11-04'].map(date =>
  ({ date, maxItems: 5, itemIds: [1, 2] })) };
function fixture(local = { lines: [], date: '' }, remote = accountCart(), snapshot = shopping) {
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
    getShopping: () => snapshot,
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
      getShopping: () => shopping,
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

test('anonymous edits stay local; login merges once and retains totals over five until reduced', async () => {
  const device = { ...basket, lines: [{ itemId: 1, quantity: 5 }] };
  const f = fixture(device);
  f.sync.changed();
  await f.sync.refresh(); await f.sync.save(); await f.tick();
  assert.equal(f.calls.length, 0);
  f.sync.setIdentity(7);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.sync.refresh(), true);
  assert.equal(typeof f.sync.choose, 'undefined');
  assert.equal(f.sync.state.retry, false);
  assert.equal(f.sync.state.associated, true);
  assert.deepEqual(f.local, { lines: [{ itemId: 1, quantity: 7 }], date: '' });
  assert.equal(f.replacements.length, 1);
  assert.equal(f.associations, 0, 'overflow has no accepted save yet');
  assert.equal(f.timers.size, 0);
  await f.sync.save(); await f.sync.refresh(); await f.tick();
  assert.equal(await f.sync.flush(), false);
  assert.deepEqual(f.requests().map(call => call.method), [undefined]);
  assert.match(f.sync.state.message, /five|bulk/i);
  f.edit(device); await f.tick();
  assert.deepEqual(f.requests().map(call => call.method), [undefined, 'PUT']);
  assert.deepEqual(f.requests().at(-1).body, { version: 4, ...device });
  assert.deepEqual(f.local, device);
  assert.equal(f.sync.state.cart.version, 5);
  assert.equal(f.sync.state.dirty, false);
});

for (const [label, localDate, snapshot, expectedDate] of [
  ['valid local whole-basket date wins', '2026-11-03', shopping, '2026-11-03'],
  ['local date without capacity falls back to saved', '2026-11-03', { dates: [
    { date: '2026-11-03', maxItems: 1, itemIds: [1, 2] }, ...shopping.dates.filter(day => day.date !== '2026-11-03')
  ] }, basket.date],
  ['local date missing a merged product falls back to saved', '2026-11-03', { dates: [
    { date: '2026-11-03', maxItems: 5, itemIds: [2] }, ...shopping.dates.filter(day => day.date !== '2026-11-03')
  ] }, basket.date],
  ['invalid local date falls back to saved', '2026-11-09', shopping, basket.date],
  ['neither date fits', '2026-11-03', { dates: [] }, ''],
  ['missing availability clears date', '2026-11-03', null, '']
]) {
  test(`initial merge keeps both baskets with deterministic IDs: ${label}`, async () => {
    const f = fixture({ lines: [{ itemId: 2, quantity: 1 }], date: localDate }, accountCart(9), snapshot);
    f.sync.setIdentity(7);
    assert.equal(await f.sync.refresh(), true);
    const merged = { lines: [{ itemId: 1, quantity: 2 }, { itemId: 2, quantity: 1 }], date: expectedDate };
    assert.deepEqual(f.local, merged);
    assert.equal(f.sync.state.cart.version, 9);
    assert.equal(f.replacements.length, 1);
    assert.equal(f.associations, 0, 'merge is not a save acknowledgement');
    assert.deepEqual(f.requests().map(call => call.method), [undefined]);
    assert.equal(await f.sync.refresh(), false);
    await f.tick();
    assert.deepEqual(f.requests().map(call => call.method), [undefined, 'PUT']);
    assert.deepEqual(f.requests().at(-1).body, { version: 9, ...merged, date: expectedDate || null });
    assert.equal(await f.sync.refresh(), false);
    assert.equal(await f.sync.flush(), true);
    assert.deepEqual(f.local, merged);
    assert.equal(f.replacements.length, 1);
  });
}

test('identical baskets sum exactly once regardless of line order, retaining every item above the limit', async () => {
  const local = { ...basket, lines: [...basket.lines, { itemId: 2, quantity: 1 }] };
  const remote = { ...local, lines: [...local.lines].reverse() };
  assert.equal(sameBasket(local, remote), true);
  assert.equal(sameBasket({ lines: [], date: '' }, { lines: [], date: null }), true);
  const f = fixture(local, accountCart(6, remote));
  f.sync.setIdentity(7);
  assert.equal(await f.sync.refresh(), true);
  assert.equal(f.sync.state.associated, true);
  assert.equal(f.associations, 0);
  const merged = { lines: [{ itemId: 1, quantity: 4 }, { itemId: 2, quantity: 2 }], date: '' };
  assert.deepEqual(f.local, merged);
  assert.equal(f.replacements.length, 1);
  assert.equal(f.sync.state.dirty, true);
  assert.equal(await f.sync.flush(), false);
  assert.equal(await f.sync.refresh(), false);
  await f.sync.save(); await f.tick();
  assert.deepEqual(f.local, merged);
  assert.equal(f.associations, 0);
  assert.equal(f.requests().length, 1);
});

test('identical saveable baskets also sum exactly once and never reload on repeated refresh', async () => {
  const f = fixture(basket);
  f.sync.setIdentity(7); await f.sync.refresh();
  const merged = { ...basket, lines: [{ itemId: 1, quantity: 4 }] };
  assert.deepEqual(f.local, merged);
  assert.equal(f.sync.state.dirty, true);
  await f.sync.refresh(); await f.tick();
  assert.deepEqual(f.requests().at(-1).body, { version: 4, ...merged });
  const count = f.calls.length;
  await f.sync.refresh(); await f.sync.refresh(); await f.tick();
  assert.equal(await f.sync.flush(), true);
  assert.equal(f.calls.length, count);
  assert.deepEqual(f.local, merged);
  assert.equal(f.associations, 1);
  assert.equal(f.replacements.length, 1);
});

test('an empty device automatically loads an available account basket without PUT', async () => {
  const f = fixture({ lines: [], date: '' });
  f.sync.setIdentity(7); await f.sync.refresh();
  assert.deepEqual(f.local, basket);
  assert.equal(f.replacements.length, 1);
  assert.equal(f.sync.state.retry, false);
  assert.equal(f.sync.state.associated, true);
  assert.deepEqual(f.requests().map(call => call.method), [undefined]);
});

test('a failed initial GET retains device intent until explicit retry merges it once', async () => {
  const f = fixture(basket), original = f.api.request;
  f.api.request = async (...args) => { await original(...args); throw new Error('private backend text'); };
  f.sync.setIdentity(7);
  assert.equal(await f.sync.refresh(), false);
  assert.equal(f.sync.state.retry, true);
  assert.equal(f.sync.state.associated, false);
  assert.deepEqual(f.local, basket);
  assert.equal(f.replacements.length, 0);
  assert.doesNotMatch(f.sync.state.message, /private backend text/);
  const count = f.calls.length;
  await f.sync.refresh(); await f.sync.save(); await f.tick();
  assert.equal(f.calls.length, count);
  f.api.request = original;
  assert.equal(await f.sync.retry(), true);
  assert.deepEqual(f.local, { ...basket, lines: [{ itemId: 1, quantity: 4 }] });
  assert.equal(f.associations, 0);
  assert.equal(f.sync.state.retry, false);
  assert.deepEqual(f.requests().map(call => call.method), [undefined, undefined]);
  assert.equal(await f.sync.flush(), true);
});

test('unavailable account lines are retained in the merge but never sent until explicitly removed locally', async () => {
  const f = fixture(basket, accountCart(12, { ...basket, lines: [{ itemId: 99, quantity: 3 }] }));
  f.sync.setIdentity(7); await f.sync.refresh();
  assert.equal(f.sync.state.associated, true);
  assert.deepEqual(f.local, { lines: [{ itemId: 1, quantity: 2 }, { itemId: 99, quantity: 3 }], date: '' });
  assert.equal(f.replacements.length, 1);
  assert.equal(await f.sync.save(), false);
  await f.tick();
  assert.deepEqual(f.requests().map(call => call.method), [undefined]);
  f.edit(basket);
  assert.equal(await f.sync.flush(), true);
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

for (const kind of ['wrong version', 'wrong lines', 'wrong date', 'malformed', 'network']) {
  test(`${kind} save acknowledgement preserves local edits and requires explicit retry, never auto-retries`, async () => {
    const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
    const edit = { ...basket, lines: [{ itemId: 1, quantity: 3 }] };
    const original = f.api.request;
    f.api.request = async (...args) => {
      const value = await original(...args);
      if (args[3] !== 'PUT') return value;
      if (kind === 'network') throw new Error('private backend text');
      if (kind === 'wrong version') return { ...value, version: value.version + 1 };
      if (kind === 'wrong lines') return accountCart(value.version, basket);
      if (kind === 'wrong date') return { ...value, date: '2026-11-02' };
      return { ...value, version: '5' };
    };
    f.edit(edit);
    assert.equal(await f.sync.save(), false);
    assert.equal(f.sync.state.retry, true);
    assert.equal(f.sync.state.dirty, true);
    assert.equal(f.sync.state.cart.version, 4);
    assert.deepEqual(f.local, edit);
    assert.doesNotMatch(f.sync.state.message, /private backend text/);
    const count = f.calls.length;
    f.sync.schedule(); await f.tick(); await f.sync.refresh(); await f.sync.save();
    assert.equal(await f.sync.flush(), false);
    assert.equal(f.calls.length, count);
    f.api.request = original;
    assert.equal(await f.sync.retry(), true);
    assert.equal(f.sync.state.retry, false);
    assert.equal(f.sync.state.dirty, false);
    assert.equal(f.replacements.length, 1, 'save acknowledgements never replace the local basket');
    assert.equal(f.requests().filter(call => call.method === 'PUT').length, 2);
    assert.deepEqual(f.requests().at(-1).body, { version: 4, ...edit });
  });
}

test('409 reads only the remote version and retries once using the latest edit made during that GET', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  const reply = deferred(), started = deferred(), original = f.api.request;
  const first = { ...basket, lines: [{ itemId: 1, quantity: 3 }] };
  const newer = { lines: [{ itemId: 2, quantity: 4 }], date: '2026-11-03' };
  f.api.request = async (...args) => {
    const value = await original(...args);
    if (args[3] === 'PUT' && args[1].version === 4) {
      throw Object.assign(new Error('private conflict text'), { status: 409 });
    }
    if (args[3] !== 'PUT') { started.resolve(); return reply.promise; }
    return value;
  };
  f.edit(first);
  const pending = f.sync.save(); await started.promise;
  assert.deepEqual(f.local, first);
  assert.equal(f.replacements.length, 1);
  f.edit(newer);
  // Deliberately not a valid cart: conflict recovery must consume version ONLY.
  reply.resolve({ version: 9, lines: [{ itemId: 99, quantity: 90 }], date: 'not-a-date', quote: 'private remote quote' });
  assert.equal(await pending, true);
  assert.deepEqual(f.requests().map(call => call.method), [undefined, 'PUT', undefined, 'PUT']);
  assert.deepEqual(f.requests().filter(call => call.method === 'PUT').map(call => call.body),
    [{ version: 4, ...first }, { version: 9, ...newer }]);
  assert.equal(f.calls.filter(call => call.path === 'session').length, 2);
  assert.deepEqual(f.local, newer);
  assert.equal(f.replacements.length, 1, 'neither conflict GET nor PUT acknowledgement applies remote intent');
  assert.equal(f.sync.state.cart.version, 10);
  assert.equal(f.sync.state.dirty, false);
  assert.equal(f.sync.state.retry, false);
  const count = f.calls.length;
  await f.tick(); await f.sync.refresh();
  assert.equal(await f.sync.flush(), true);
  assert.equal(f.calls.length, count);
});

test('repeated 409 is bounded to one internal GET and two PUTs, then requires explicit retry', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  const original = f.api.request;
  const edit = { ...basket, lines: [{ itemId: 2, quantity: 3 }] };
  f.api.request = async (...args) => {
    await original(...args);
    if (args[3] === 'PUT') throw Object.assign(new Error('private conflict text'), { status: 409 });
    return { version: 9, lines: [{ itemId: 1, quantity: 5 }], date: '2026-11-04' };
  };
  f.edit(edit);
  assert.equal(await f.sync.save(), false);
  assert.deepEqual(f.requests().map(call => call.method), [undefined, 'PUT', undefined, 'PUT']);
  assert.deepEqual(f.requests().filter(call => call.method === 'PUT').map(call => call.body),
    [{ version: 4, ...edit }, { version: 9, ...edit }]);
  assert.equal(f.sync.state.cart.version, 9);
  assert.deepEqual(f.sync.state.cart.lines, basket.lines, 'conflict GET never adopts remote lines');
  assert.equal(f.sync.state.cart.date, basket.date, 'conflict GET never adopts remote date');
  assert.deepEqual(f.local, edit);
  assert.equal(f.replacements.length, 1);
  assert.equal(f.sync.state.retry, true);
  assert.equal(f.sync.state.dirty, true);
  assert.doesNotMatch(f.sync.state.message, /private conflict text/);
  const count = f.calls.length;
  f.sync.schedule(); await f.tick(); await f.sync.refresh(); await f.sync.save();
  assert.equal(await f.sync.flush(), false);
  assert.equal(f.calls.length, count);
  f.api.request = original;
  assert.equal(await f.sync.retry(), true);
  assert.deepEqual(f.requests().at(-1).body, { version: 9, ...edit });
  assert.equal(f.sync.state.cart.version, 10);
  assert.equal(f.sync.state.retry, false);
  assert.equal(f.sync.state.dirty, false);
  assert.equal(f.requests().filter(call => call.method === 'PUT').length, 3);
});

test('device edits during initial GET merge current intent once with the saved basket', async () => {
  const f = fixture({ lines: [], date: '' }), reply = deferred(), started = deferred();
  const original = f.api.request;
  f.api.request = async (...args) => { await original(...args); started.resolve(); return reply.promise; };
  f.sync.setIdentity(7);
  const pending = f.sync.refresh(); await started.promise;
  const edit = { ...basket, lines: [{ itemId: 2, quantity: 3 }] };
  f.edit(edit); reply.resolve(accountCart());
  assert.equal(await pending, true);
  const merged = { ...basket, lines: [{ itemId: 1, quantity: 2 }, { itemId: 2, quantity: 3 }] };
  assert.deepEqual(f.local, merged);
  assert.equal(f.replacements.length, 1);
  assert.equal(f.sync.state.associated, true);
  assert.equal(f.sync.state.dirty, true);
  assert.deepEqual(f.requests().map(call => call.method), [undefined]);
  f.api.request = original;
  await f.tick();
  assert.deepEqual(f.requests().at(-1).body, { version: 4, ...merged });
  assert.equal(await f.sync.refresh(), false);
  assert.deepEqual(f.local, merged);
});

test('edits before the initial account GET merge once and save with the fetched version', async () => {
  const f = fixture({ lines: [], date: '' }); f.sync.setIdentity(7);
  const edit = { ...basket, lines: [{ itemId: 2, quantity: 3 }] };
  f.edit(edit);
  assert.equal(await f.sync.refresh(), true);
  assert.equal(f.sync.state.associated, true);
  assert.equal(f.sync.state.cart.version, 4);
  const merged = { ...basket, lines: [{ itemId: 1, quantity: 2 }, { itemId: 2, quantity: 3 }] };
  assert.deepEqual(f.local, merged);
  assert.equal(f.requests().some(call => call.method === 'PUT'), false);
  assert.equal(await f.sync.flush(), true);
  assert.deepEqual(f.requests().at(-1).body, { version: 4, ...merged });
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
    await f.sync.refresh(); await f.sync.save(); await f.sync.retry(); await f.tick();
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
    const edit = { ...basket, lines: [{ itemId: 1, quantity: 3 }] };
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

test('interrupted PUT retains newer edits and requires explicit retry after reconnect, not automatic saving', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  const reply = deferred(), started = deferred(), original = f.api.request;
  f.api.request = async (...args) => { const value = await original(...args);
    if (args[3] === 'PUT') { started.resolve(); return reply.promise; } return value; };
  const edit = { ...basket, lines: [{ itemId: 1, quantity: 3 }] };
  f.edit(edit); const pending = f.sync.save(); await started.promise;
  const newer = { ...basket, lines: [{ itemId: 2, quantity: 4 }] };
  f.edit(newer);
  f.active = false; f.sync.pause();
  assert.equal(f.requests().at(-1).signal.aborted, true);
  reply.resolve(accountCart(5, edit)); await pending;
  f.active = true;
  const count = f.calls.length;
  f.sync.schedule(); await f.tick(); await f.sync.refresh(); await f.sync.save();
  assert.equal(await f.sync.flush(), false);
  assert.equal(f.calls.length, count);
  assert.equal(f.sync.state.retry, true);
  assert.equal(f.sync.state.cart.version, 4);
  assert.equal(f.sync.state.dirty, true);
  assert.deepEqual(f.local, newer);
  f.api.request = original;
  assert.equal(await f.sync.retry(), true);
  assert.deepEqual(f.requests().at(-1).body, { version: 4, ...newer });
  assert.equal(f.sync.state.retry, false);
  assert.equal(await f.sync.flush(), true);
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

test('transition hold cancels debounce and defers post-bootstrap PUT until release without a conflict or busy deadlock', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  f.edit({ ...basket, lines: [{ itemId: 1, quantity: 3 }] });
  f.sync.hold(); assert.equal(f.timers.size, 0);
  const count = f.calls.length;
  await f.sync.save(); await f.sync.refresh();
  assert.equal(f.calls.length, count);
  f.sync.release(); assert.equal(f.timers.size, 1);
  const bootstrap = deferred(), started = deferred();
  f.api.session = async () => { started.resolve(); return bootstrap.promise; };
  const saving = f.sync.save(); await started.promise;
  f.sync.hold(); bootstrap.resolve(session); await saving;
  assert.equal(f.requests().some(call => call.method === 'PUT'), false);
  assert.equal(f.sync.state.busy, false); assert.equal(f.sync.state.retry, false);
  assert.equal(f.sync.state.dirty, true);
  f.sync.release(); await f.tick();
  assert.equal(f.requests().filter(call => call.method === 'PUT').length, 1);
  assert.equal(f.sync.state.cart.lines[0].quantity, 3);
  assert.equal(f.sync.state.dirty, false); assert.equal(f.sync.state.busy, false);
});

test('checkout conflict fence survives local edits and failed explicit retry until a successful flush', async () => {
  const f = fixture(); f.sync.setIdentity(7); await f.sync.refresh();
  const original = f.api.request;
  f.sync.conflict();
  f.edit({ ...basket, lines: [{ itemId: 2, quantity: 3 }] });
  assert.equal(f.sync.state.retry, true);
  const count = f.calls.length;
  await f.tick(); assert.equal(await f.sync.flush(), false);
  assert.equal(f.calls.length, count);
  f.api.request = async () => { throw new Error('offline'); };
  assert.equal(await f.sync.retry(), false);
  assert.equal(f.sync.state.retry, true);
  assert.equal(await f.sync.flush(), false);
  f.api.request = original;
  assert.equal(await f.sync.retry(), true);
  assert.equal(await f.sync.flush(), true);
  assert.deepEqual(f.requests().at(-1).body, { version: 4, lines: [{ itemId: 2, quantity: 3 }], date: basket.date });
});

test('association retirement occurs once only after accepted save, never merge or lost acknowledgement', async () => {
  const f = fixture({ ...basket, lines: [{ itemId: 2, quantity: 1 }] });
  let receipts = 0, accepted = 0;
  f.sync.guestIntent = { uncertain: () => false, beforeSave: () => { receipts++; return true; }, accepted: () => { accepted++; return true; } };
  f.sync.setIdentity(7); await f.sync.refresh();
  assert.equal(f.associations, 0); assert.equal(accepted, 0);
  const original = f.api.request;
  f.api.request = async (...args) => { if (args[3] === 'PUT') throw new Error('lost'); return original(...args); };
  assert.equal(await f.sync.save(), false);
  assert.equal(receipts, 1); assert.equal(accepted, 0); assert.equal(f.associations, 0);
  f.api.request = original;
  assert.equal(await f.sync.retry(), true);
  assert.equal(accepted, 1); assert.equal(f.associations, 1);
  f.edit(basket); await f.sync.flush();
  assert.equal(accepted, 1); assert.equal(f.associations, 1);
});