import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PRODUCT_NAMES, STORAGE_KEY, catalogBindings, validateLines, readBasket,
  saveBasket, changeQuantity, LatestRequest, validDate, validateQuote, appendQuoteLine } from '../model.mjs';
import { StorefrontApi, ApiError } from '../api.mjs';
import { quantityControl } from '../view.mjs';

const ids = new Set([1, 2]);
const catalog = { items: PRODUCT_NAMES.map((name, index) => ({ id: index + 1, name })), deliveryDates: ['2026-11-01'] };
const session = token => ({ authenticated: false, customer: null, csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: token });
const response = body => ({ ok: true, json: async () => body });
function memoryStorage(raw = null) {
  return { raw, getItem(key) { assert.equal(key, STORAGE_KEY); return this.raw; },
    setItem(key, value) { assert.equal(key, STORAGE_KEY); this.raw = value; }, removeItem() { this.raw = null; } };
}

test('all 20 current public headings exactly match the pinned mapping', async () => {
  const html = await readFile(new URL('../../breads.html', import.meta.url), 'utf8');
  const beforeOffers = html.slice(0, html.indexOf('<section id="offers">'));
  const headings = [...beforeOffers.matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1].replaceAll('&amp;', '&').trim());
  assert.deepEqual(headings.toSorted(), [...PRODUCT_NAMES].toSorted());
  assert.equal(catalogBindings(catalog, headings).size, 20);
  assert.match(html, /type="module" src="storefront\/storefront.mjs"/);
});

test('mapping uses catalogue IDs, not array position, prices, fuzzy aliases or public extra products', () => {
  const name = PRODUCT_NAMES[0];
  const bindings = catalogBindings({ ...catalog, items: [{ id: 812, name }, { id: 900, name: 'Unlisted bake' }] },
    [name, name.toLowerCase(), 'Unlisted bake']);
  assert.deepEqual([...bindings], [[name, { id: 812, name }]]);
});
test('missing/retired mappings and duplicate headings cannot be ordered', () => {
  assert.equal(catalogBindings({ ...catalog, items: [] }, PRODUCT_NAMES).size, 0);
  assert.equal(catalogBindings(catalog, [PRODUCT_NAMES[0], PRODUCT_NAMES[0]]).size, 0);
});
test('duplicate catalogue names/IDs and invalid numeric IDs fail closed', () => {
  for (const items of [
    [{ id: 1, name: 'a' }, { id: 2, name: 'a' }],
    [{ id: 1, name: 'a' }, { id: 1, name: 'b' }],
    [{ id: '1', name: 'a' }], [{ id: 0, name: 'a' }],
    [{ id: Number.MAX_SAFE_INTEGER + 1, name: 'a' }]
  ]) assert.throws(() => catalogBindings({ ...catalog, items }, PRODUCT_NAMES));
});
test('calendar validation rejects malformed/impossible delivery dates', () => {
  for (const date of ['2026-02-30', '2026-2-01', '', null, '../auth/logout']) assert.equal(validDate(date), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.throws(() => catalogBindings({ ...catalog, deliveryDates: ['bad'] }, []));
});
test('persistence round trips ONLY IDs/quantities', () => {
  const storage = memoryStorage();
  const lines = [{ itemId: 1, quantity: 2 }];
  assert.equal(saveBasket(storage, lines, ids), true);
  assert.equal(storage.raw, '[{"itemId":1,"quantity":2}]');
  assert.deepEqual(readBasket(storage, ids), { lines, warning: '' });
});
test('malformed, oversized, unknown and retired stored baskets are discarded wholesale', () => {
  for (const raw of ['broken', '{}', 'null', ' '.repeat(8193),
    '[{"itemId":2,"quantity":1},{"itemId":999,"quantity":1}]',
    '[{"itemId":1,"quantity":1,"phone":"private"}]']) {
    const storage = memoryStorage(raw);
    const result = readBasket(storage, ids);
    assert.deepEqual(result.lines, []);
    assert.ok(result.warning);
    assert.equal(storage.raw, null);
  }
});
test('blocked storage degrades honestly to memory without crashing', () => {
  const storage = { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } };
  assert.ok(readBasket(storage, ids).warning);
  assert.equal(saveBasket(storage, [], ids), false);
  assert.ok(readBasket(undefined, ids).warning);
});
test('strict storage rejects duplicates, coercion, fractions, zero, overflow and secret fields', () => {
  for (const value of [null, {}, [{ itemId: 1, quantity: 0 }], [{ itemId: 1, quantity: 100 }],
    [{ itemId: 1, quantity: 1.5 }], [{ itemId: 1, quantity: '2' }],
    [{ itemId: '1', quantity: 2 }], [{ itemId: 1, quantity: 1, csrfToken: 'secret' }],
    [{ itemId: 1, quantity: 1 }, { itemId: 1, quantity: 1 }]]) {
    assert.throws(() => validateLines(value, ids));
  }
});
test('quantity bounds are 40 distinct lines / 99 each; removal at zero; immutable updates', () => {
  const allowed = new Set(Array.from({ length: 41 }, (_, i) => i + 1));
  const lines = [...allowed].slice(0, 40).map(itemId => ({ itemId, quantity: 99 }));
  assert.equal(changeQuantity(lines, 41, 1, allowed).length, 40);
  assert.equal(changeQuantity(lines, 1, 1, allowed)[0].quantity, 99);
  assert.throws(() => validateLines([...lines, { itemId: 41, quantity: 1 }], allowed));
  const one = [{ itemId: 1, quantity: 1 }];
  assert.deepEqual(changeQuantity(one, 1, -1, ids), []);
  assert.deepEqual(one, [{ itemId: 1, quantity: 1 }]);
  assert.deepEqual(changeQuantity([], 2, 1, ids), [{ itemId: 2, quantity: 1 }]);
  assert.throws(() => changeQuantity([], 3, 1, ids));
});
test('older in-flight response is rejected even when the transport ignores abort', async () => {
  const latest = new LatestRequest();
  const first = latest.begin();
  let deliver;
  const delayed = new Promise(resolve => { deliver = resolve; });
  const accepted = delayed.then(() => latest.current(first));
  const second = latest.begin();
  assert.equal(first.signal.aborted, true);
  deliver();
  assert.equal(await accepted, false);
  assert.equal(latest.current(second), true);
});
test('identity/date/offline invalidation rejects otherwise-successful pending quotes', () => {
  for (const _reason of ['identity', 'date', 'offline', 'hidden', 'basket', 'expired']) {
    const latest = new LatestRequest();
    const ticket = latest.begin();
    latest.invalidate();
    assert.equal(latest.current(ticket), false);
  }
});

const quote = { lines: [{ itemId: 1, name: 'Bread', quantity: 2, unitPrice: 13, lineTotal: 26 }],
  date: '2026-11-01', valid: true, problems: [], listSubtotal: 26, discountAmount: 0,
  batchDiscountAmount: 0, deliveryCharge: 0, creditApplied: 0, totalAmount: 19.17 };
test('server monetary output is accepted verbatim, never recalculated by client', () => {
  assert.equal(validateQuote(quote, [{ itemId: 1, quantity: 2 }], '2026-11-01').totalAmount, 19.17);
});
test('wrong quote identity/quantity/date, duplicate lines and malformed money rejected', () => {
  const lines = [{ itemId: 1, quantity: 2 }];
  for (const bad of [{ ...quote, date: null }, { ...quote, totalAmount: '19.17' },
    { ...quote, creditApplied: -1 }, { ...quote, totalAmount: Infinity },
    { ...quote, lines: [{ ...quote.lines[0], itemId: 2 }] },
    { ...quote, lines: [{ ...quote.lines[0], quantity: 3 }] },
    { ...quote, problems: [{}] }]) assert.throws(() => validateQuote(bad, lines, '2026-11-01'));
  assert.throws(() => validateQuote({ ...quote, lines: [quote.lines[0], quote.lines[0]] },
    [...lines, { itemId: 2, quantity: 1 }], '2026-11-01'));
});
test('special unit price is optional, null, or a non-negative number', () => {
  const lines = [{ itemId: 1, quantity: 2 }];
  for (const specialUnitPrice of [null, 0, 9.5]) {
    assert.equal(validateQuote({ ...quote, lines: [{ ...quote.lines[0], specialUnitPrice }] }, lines, '2026-11-01').valid, true);
  }
  for (const specialUnitPrice of [-1, '9', Infinity]) {
    assert.throws(() => validateQuote({ ...quote, lines: [{ ...quote.lines[0], specialUnitPrice }] }, lines, '2026-11-01'));
  }
});
test('quote lines strike through the list price only when a special price applies', () => {
  const money = { format: value => `Rs${value}` };
  const make = (tag, text) => ({ tag, text });
  const target = () => ({ parts: [], textContent: '', append(...nodes) { this.parts.push(...nodes); } });
  const plain = appendQuoteLine(target(), { ...quote.lines[0], specialUnitPrice: null }, money, make);
  assert.equal(plain.textContent, 'Bread · 2 × Rs13 · Rs26');
  assert.deepEqual(plain.parts, []);
  const special = appendQuoteLine(target(), { ...quote.lines[0], specialUnitPrice: 9.5 }, money, make);
  assert.deepEqual(special.parts, [{ tag: 'span', text: 'Bread · 2 × ' }, { tag: 's', text: 'Rs13' }, { tag: 'span', text: ' Rs9.5 · Rs19' }]);
});
test('no-date quote accepts the exact backend null contract', () => {
  assert.equal(validateQuote({ ...quote, date: null, valid: false, problems: [{ message: 'Choose date' }] },
    [{ itemId: 1, quantity: 2 }], '').valid, false);
});
test('unsafe requests require bootstrap; exact route allowlist prevents API host/path injection', async () => {
  let calls = 0;
  const api = new StorefrontApi(async () => { calls++; return response({}); });
  await assert.rejects(api.request('/api/quote', { lines: [] }), /bootstrap/);
  for (const path of ['https://example.com/api/session', '//example.com/api/session', '/api/session?phone=1',
    '/api/checkout', '/api/auth/../quote', '/api/orders']) await assert.rejects(api.request(path));
  assert.equal(calls, 0);
});
test('all requests use same-origin credentials, no-store and reject redirects; body has no prices', async () => {
  const calls = [];
  const api = new StorefrontApi(async (path, options) => { calls.push({ path, options }); return response(session('token')); });
  await api.session();
  await api.request('/api/catalog');
  await api.request('/api/quote', { lines: [{ itemId: 1, quantity: 2 }], date: '2026-11-01' });
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
  }
  assert.equal(calls[2].options.headers['X-XSRF-TOKEN'], 'token');
  assert.deepEqual(JSON.parse(calls[2].options.body), { lines: [{ itemId: 1, quantity: 2 }], date: '2026-11-01' });
  assert.equal(calls[0].options.body, undefined);
});
test('verify and logout replacement tokens supersede bootstrap token; no cookie reads', async () => {
  const calls = [];
  const api = new StorefrontApi(async (path, options) => {
    calls.push(options);
    return response(session(path === '/api/auth/verify' ? 'verified' : 'logged-out'));
  });
  api.useSession(session('initial'));
  await api.authenticate('/api/auth/verify', { challengeId: 'binding', code: '123456' });
  await api.authenticate('/api/auth/logout');
  await api.request('/api/quote', { lines: [] });
  assert.deepEqual(calls.map(call => call.headers['X-XSRF-TOKEN']), ['initial', 'verified', 'logged-out']);
  assert.equal(calls[1].body, undefined);
  api.clearSession();
  await assert.rejects(api.request('/api/quote', { lines: [] }));
});
test('malformed session/header identity is rejected and clears existing credentials', async () => {
  const api = new StorefrontApi(async () => response({}));
  for (const value of [session(''), { ...session('ok'), csrfHeaderName: 'Authorization' },
    { ...session('ok'), csrfHeaderName: 'X-CSRF-TOKEN' },
    session('bad\r\ntoken'), { ...session('ok'), authenticated: true, customer: null }]) {
    api.useSession(session('before'));
    assert.throws(() => api.useSession(value));
    await assert.rejects(api.request('/api/auth/logout'));
  }
});
test('quantity controls expose a labelled polite status; blocked + remains actionable for explanation', () => {
  const original = globalThis.document;
  try {
    globalThis.document = { createElement() { return {
      attributes: {}, children: [],
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener() {}, append(...children) { this.children.push(...children); }
    }; } };
    const control = quantityControl({ id: 1, name: 'Bread' }, () => {});
    control.update(2, false);
    const [minus, count, plus] = control.root.children;
    assert.equal(count.attributes.role, 'status');
    assert.equal(count.attributes['aria-live'], 'polite');
    assert.equal(count.attributes['aria-label'], 'Bread quantity');
    assert.equal(count.textContent, '2');
    assert.equal(minus.disabled, false);
    control.update(99, false);
    assert.equal(plus.disabled, false);
    control.update(0, false);
    assert.equal(minus.disabled, true);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});
test('errors are generic, do not read server payload, and NEVER retry unsafe calls', async () => {
  let calls = 0;
  const api = new StorefrontApi(async () => {
    calls++;
    return { ok: false, status: 429, json() { throw new Error('must not read secret error'); } };
  });
  api.useSession(session('valid'));
  await assert.rejects(api.request('/api/auth/challenge', { phone: '+919999999999' }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 429);
    assert.equal(error.message.includes('999'), false);
    return true;
  });
  assert.equal(calls, 1);
});
test('abort propagates to network and prevents pending request completion', async () => {
  const api = new StorefrontApi((_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const controller = new AbortController();
  const pending = api.request('/api/session', undefined, controller.signal);
  controller.abort();
  await assert.rejects(pending, /aborted/);
});
test('config stays off without a production origin and allows explicit pre-script test injection', async () => {
  const code = await readFile(new URL('../config.js', import.meta.url), 'utf8');
  const normal = { window: {} };
  vm.runInNewContext(code, normal);
  assert.equal(normal.window.TRANCHE_STOREFRONT.enabled, false);
  assert.equal(Object.isFrozen(normal.window.TRANCHE_STOREFRONT), true);
  const injected = { window: { TRANCHE_STOREFRONT: { enabled: true } } };
  vm.runInNewContext(code, injected);
  assert.equal(injected.window.TRANCHE_STOREFRONT.enabled, true);
});
test('disabled and non-boolean config produce ZERO network/storage/DOM/listener activity', async () => {
  const original = globalThis.window;
  try {
    for (const enabled of [false, undefined, 'true', 1]) {
      globalThis.window = new Proxy({ TRANCHE_STOREFRONT: { enabled } }, {
        get(target, key) {
          if (key === 'TRANCHE_STOREFRONT') return target[key];
          throw new Error(`Disabled enhancement touched ${String(key)}`);
        }
      });
      // No document or HTMLDialogElement exists in Node: either access would fail.
      await import(`../storefront.mjs?disabled=${String(enabled)}`);
    }
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});

test('enabled startup makes no requests or storage reads while initially hidden or offline', async () => {
  const saved = Object.fromEntries(['window', 'document', 'navigator', 'HTMLDialogElement', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [hidden, onLine] of [[true, true], [false, false], [true, false]]) {
      const win = new EventTarget(), doc = new EventTarget();
      win.TRANCHE_STOREFRONT = { enabled: true, checkoutEnabled: true }; doc.hidden = hidden;
      Object.defineProperty(win, 'localStorage', { get() { throw new Error('Must not read storage'); } });
      Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine } });
      Object.defineProperty(globalThis, 'HTMLDialogElement', { configurable: true, value: class {} });
      let calls = 0;
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: () => { calls++; throw new Error('Must not fetch'); } });
      await import(`../storefront.mjs?paused=${hidden}-${onLine}`);
      assert.equal(calls, 0);
    }
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});