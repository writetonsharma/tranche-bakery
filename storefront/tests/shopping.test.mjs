import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, StorefrontApi } from '../api.mjs';
import {
  RETAIL_LIMIT, ESTIMATE_WARNING, shoppingInput, validateShopping, fitsDate,
  basketReadiness, additionProblem, mergeBaskets, estimatePaise, totalItems
} from '../shopping-model.mjs';

// Fixed contract fixtures: no clock, network, account, storage or provider calls.
const DATES = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
  '2026-11-02', '2026-11-03', '2026-11-05'];
const session = (csrfToken = 'bootstrap-token', authenticated = false) => ({
  authenticated, customer: authenticated ? { id: 7 } : null,
  csrfHeaderName: 'X-XSRF-TOKEN', csrfToken
});
const item = (id, unitPrice = 80) => ({
  id, name: `Loaf ${id}`, category: 'Breads', description: null,
  weightLabel: null, listPrice: 100, unitPrice, priceLabel: null,
  singleItemBatchDiscount: null
});
const snapshot = (date = null) => ({
  retailLimit: 5, date, pricingMode: 'SINGLE_ITEM_ESTIMATE',
  items: [item(1), item(2)],
  dates: DATES.map(date => ({ date, maxItems: 5, itemIds: [1, 2] }))
});
const basket = (lines = [], date = '') => ({ lines, date });
const line = (itemId, quantity = 1) => ({ itemId, quantity });

test('shopping input accepts only empty, null-date and real ISO-date objects', () => {
  for (const body of [{}, { date: null }, { date: DATES[0] }, { date: '2028-02-29' }]) {
    const result = shoppingInput(body);
    assert.deepEqual(result, body);
    assert.notEqual(result, body, 'copy the allowlisted request, not the caller object');
  }
});

const badBodies = [
  ['missing body', undefined], ['null body', null], ['array', []],
  ['array containing date', [{ date: DATES[0] }]], ['string', DATES[0]],
  ['number', 1], ['boolean', false], ['function', () => ({})],
  ['undefined date', { date: undefined }], ['empty date', { date: '' }],
  ['un-padded date', { date: '2026-1-01' }], ['timestamp', { date: `${DATES[0]}T00:00:00Z` }],
  ['impossible day', { date: '2026-02-30' }], ['non-leap February', { date: '2026-02-29' }],
  ['impossible month', { date: '2026-13-01' }], ['zero day', { date: '2026-10-00' }],
  ['date whitespace', { date: `${DATES[0]} ` }], ['date newline', { date: `${DATES[0]}\n` }],
  ['Date instance value', { date: new Date(`${DATES[0]}T00:00:00Z`) }],
  ['numeric date', { date: 1793232000000 }], ['boolean date', { date: true }],
  ['array date', { date: [DATES[0]] }], ['object date', { date: { value: DATES[0] } }],
  ['symbol date', { date: Symbol('date') }],
  ['customer claim', { date: null, customerId: 7 }], ['extra field', { unexpected: null }],
  ['symbol key', { [Symbol('customerId')]: 7 }],
  ['hidden extra key', Object.defineProperty({}, 'customerId', { value: 7 })],
  ['null prototype', Object.create(null)],
  ['inherited date', Object.create({ date: DATES[0] })],
  ['custom prototype', Object.assign(Object.create({ customerId: 7 }), { date: null })],
  ['Date instance body', new Date(`${DATES[0]}T00:00:00Z`)],
  ['own __proto__ field', JSON.parse('{"__proto__":{"customerId":7}}')]
];

test('malformed shopping bodies fail locally before fetch', async t => {
  let fetches = 0;
  const api = new StorefrontApi(async () => { fetches++; throw new Error('Unexpected fetch'); });
  api.useSession(session());
  for (const [name, body] of badBodies) {
    await t.test(name, async () => {
      assert.throws(() => shoppingInput(body), /Invalid shopping request/);
      await assert.rejects(api.request('/api/shopping', body), /Invalid shopping request/);
    });
  }
  assert.equal(fetches, 0);
});

test('anonymous shopping POST is available with checkout disabled and exact secure fetch options', async () => {
  const calls = [];
  const response = snapshot();
  const api = new StorefrontApi(async (path, options) => {
    calls.push({ path, options });
    return { ok: true, json: async () => response };
  }, { checkoutEnabled: false });
  api.useSession(session());
  for (const body of [{}, { date: null }, { date: DATES[0] }]) {
    assert.equal(await api.request('/api/shopping', body, undefined, 'POST'), response);
    const { path, options } = calls.at(-1);
    assert.equal(path, '/api/shopping');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, JSON.stringify(body));
    assert.deepEqual(options.headers, {
      Accept: 'application/json', 'X-XSRF-TOKEN': 'bootstrap-token',
      'Content-Type': 'application/json'
    });
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
  }
  assert.equal(calls.length, 3, 'one fetch per deliberate snapshot request');
  await assert.rejects(api.request('/api/cart'), /Disallowed API route/);
  assert.equal(calls.length, 3, 'shopping does not implicitly enable checkout');
});

test('shopping requires bootstrap CSRF and always uses the latest useSession token', async () => {
  const tokens = [];
  const api = new StorefrontApi(async (_path, options) => {
    tokens.push(options.headers['X-XSRF-TOKEN']);
    return { ok: true, json: async () => snapshot() };
  });
  await assert.rejects(api.request('/api/shopping', {}), /Session bootstrap required/);
  assert.deepEqual(tokens, []);
  api.useSession(session('anonymous-token'));
  await api.request('/api/shopping', {});
  api.useSession(session('verified-rotated-token', true));
  await api.request('/api/shopping', { date: DATES[0] });
  api.useSession(session('logout-rotated-token'));
  await api.request('/api/shopping', {});
  assert.deepEqual(tokens, ['anonymous-token', 'verified-rotated-token', 'logout-rotated-token']);
  api.clearSession();
  await assert.rejects(api.request('/api/shopping', {}), /Session bootstrap required/);
  api.useSession(session('temporary-token'));
  assert.throws(() => api.useSession(session('bad\r\ntoken')), /Invalid session/);
  await assert.rejects(api.request('/api/shopping', {}), /Session bootstrap required/);
  assert.equal(tokens.length, 3, 'cleared/invalid sessions never reuse a stale token');
});

test('shopping rejects methods, query identity claims and path normalization tricks before fetch', async t => {
  let fetches = 0;
  const api = new StorefrontApi(async () => { fetches++; throw new Error('Unexpected fetch'); });
  api.useSession(session());
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'post']) {
    await t.test(`method ${method}`, async () => {
      await assert.rejects(api.request('/api/shopping', {}, undefined, method), /Disallowed API method/);
    });
  }
  const paths = [
    '/api/shopping?date=2026-10-29', '/api/shopping?customerId=7', '/api/shopping?',
    '/api/shopping#fragment', '/api/shopping/', '/api/shopping-extra', '/api/Shopping',
    '/api/shopping\n', '/api/shopping/../cart', '/api/../api/shopping',
    '/api/%73hopping', '/api/shopping%2f..%2fcart', '/api\\shopping',
    '//example.invalid/api/shopping', 'https://example.invalid/api/shopping',
    'https://www.tranchebakery.in/api/shopping', new String('/api/shopping')
  ];
  for (const path of paths) {
    await t.test(`path ${String(path)}`, async () => {
      await assert.rejects(api.request(path, {}), /Disallowed API route/);
    });
  }
  assert.equal(fetches, 0);
});

test('shopping security and application errors never parse or trust error payloads', async t => {
  for (const checkoutEnabled of [false, true]) {
    for (const [name, status, payload] of [
      ['empty security body', 403, ''], ['HTML security body', 403, '<html>private-token</html>'],
      ['disabled API', 404, ''], ['session store unavailable', 503, 'private-customer'],
      ['untrusted JSON message and allowlisted code', 400,
        { problems: [{ code: 'INVALID_REQUEST', message: 'private-phone-and-address' }] }]
    ]) {
      await t.test(`${name}, checkout=${checkoutEnabled}`, async () => {
        let bodyReads = 0;
        const api = new StorefrontApi(async () => ({
          ok: false, status,
          json: async () => { bodyReads++; return typeof payload === 'string' ? JSON.parse(payload) : payload; },
          text: async () => { bodyReads++; return String(payload); }
        }), { checkoutEnabled });
        api.useSession(session());
        await assert.rejects(api.request('/api/shopping', {}), error => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.status, status);
          assert.equal(error.code, undefined, 'shopping must not retain even a recognized checkout error code');
          assert.equal(error.message, 'Service unavailable. Please try again later.');
          assert.doesNotMatch(JSON.stringify(error), /private|problems|INVALID_REQUEST/);
          return true;
        });
        assert.equal(bodyReads, 0, 'not every filter error is JSON; no server body is trusted');
      });
    }
  }
});

test('valid snapshots preserve zero/full capacity, real dates, prices and immutable copies', () => {
  const raw = snapshot();
  raw.dates.forEach((day, index) => { day.maxItems = index % 6; });
  raw.items[0] = { ...raw.items[0], unitPrice: 0, listPrice: 0,
    description: 'Plain loaf', weightLabel: '400 g', priceLabel: 'Public offer' };
  const checked = validateShopping(raw);
  assert.equal(checked.date, null);
  assert.equal(checked.retailLimit, RETAIL_LIMIT);
  assert.deepEqual(checked, raw);
  assert.notEqual(checked, raw);
  assert.notEqual(checked.items[0], raw.items[0]);
  assert.notEqual(checked.dates[0].itemIds, raw.dates[0].itemIds);
  for (const value of [checked, checked.items, checked.items[0], checked.dates,
    checked.dates[0], checked.dates[0].itemIds]) assert.ok(Object.isFrozen(value));
  raw.items[0].unitPrice = 999;
  raw.dates[0].itemIds.push(999);
  assert.equal(checked.items[0].unitPrice, 0);
  assert.deepEqual(checked.dates[0].itemIds, [1, 2]);
  assert.throws(() => { checked.dates[0].maxItems = 5; }, TypeError);
});

test('snapshot rejects wrong envelope, mode, limit, requested date and horizon', async t => {
  for (const [name, mutate] of [
    ['wrong mode', s => { s.pricingMode = 'EXACT_TOTAL'; }],
    ['missing mode', s => { delete s.pricingMode; }],
    ['wrong retail limit', s => { s.retailLimit = 6; }],
    ['string retail limit', s => { s.retailLimit = '5'; }],
    ['wrong date', s => { s.date = DATES[0]; }],
    ['omitted date', s => { delete s.date; }],
    ['non-array items', s => { s.items = {}; }],
    ['non-array dates', s => { s.dates = {}; }],
    ['six dates', s => { s.dates.pop(); }],
    ['eight dates', s => { s.dates.push({ date: '2026-11-06', maxItems: 5, itemIds: [] }); }],
    ['duplicate date', s => { s.dates[1].date = s.dates[0].date; }],
    ['impossible date', s => { s.dates[0].date = '2026-02-30'; }],
    ['date timestamp', s => { s.dates[0].date += 'T00:00:00Z'; }],
    ['date non-string', s => { s.dates[0].date = 20261029; }],
    ['null date row', s => { s.dates[0] = null; }]
  ]) {
    await t.test(name, () => {
      const raw = snapshot();
      mutate(raw);
      assert.throws(() => validateShopping(raw), /Invalid shopping/);
    });
  }
  for (const value of [null, undefined, {}, []]) assert.throws(() => validateShopping(value), /Invalid shopping/);
  assert.throws(() => validateShopping(snapshot(), DATES[0]), /Invalid shopping snapshot/);
  assert.throws(() => validateShopping(snapshot(DATES[0]), DATES[1]), /Invalid shopping snapshot/);
  assert.throws(() => validateShopping(snapshot('2026-12-01'), '2026-12-01'), /Invalid shopping horizon/);
});

test('date maxItems is strictly an integer from zero through five', () => {
  for (let maxItems = 0; maxItems <= 5; maxItems++) {
    const raw = snapshot();
    raw.dates[0].maxItems = maxItems;
    assert.equal(validateShopping(raw).dates[0].maxItems, maxItems);
  }
  for (const maxItems of [-1, 6, 1.5, '5', null, undefined, NaN, Infinity, true]) {
    const raw = snapshot();
    raw.dates[0].maxItems = maxItems;
    assert.throws(() => validateShopping(raw), /Invalid shopping date/);
  }
});

test('snapshot rejects malformed money, nullable labels, duplicate and invalid product IDs', async t => {
  for (const field of ['unitPrice', 'listPrice', 'singleItemBatchDiscount']) {
    for (const value of [undefined, '80', -0.01, NaN, Infinity, 1.001, Number.MAX_SAFE_INTEGER]) {
      await t.test(`${field}=${String(value)}`, () => {
        const raw = snapshot(DATES[0]);
        raw.items[0][field] = value;
        assert.throws(() => validateShopping(raw, DATES[0]), /Invalid shopping item/);
      });
    }
  }
  for (const field of ['unitPrice', 'listPrice']) {
    const raw = snapshot();
    raw.items[0][field] = null;
    assert.throws(() => validateShopping(raw), /Invalid shopping item/);
  }
  for (const field of ['description', 'weightLabel', 'priceLabel']) {
    for (const value of [undefined, 1, {}, []]) {
      const raw = snapshot();
      raw.items[0][field] = value;
      assert.throws(() => validateShopping(raw), /Invalid shopping item/);
    }
  }
  for (const id of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    const raw = snapshot();
    raw.items[0].id = id;
    assert.throws(() => validateShopping(raw), /Invalid shopping item/);
  }
  const duplicate = snapshot();
  duplicate.items[1].id = duplicate.items[0].id;
  assert.throws(() => validateShopping(duplicate), /Invalid shopping item/);
  for (const itemIds of [[1, 1], [0], [-1], [1.5], ['1'], [null], {}, null]) {
    const raw = snapshot();
    raw.dates[0].itemIds = itemIds;
    assert.throws(() => validateShopping(raw), /Invalid shopping date/);
  }
  const unscopedBatch = snapshot();
  unscopedBatch.items[0].singleItemBatchDiscount = 0;
  assert.throws(() => validateShopping(unscopedBatch), /Invalid shopping item/);
});

test('scoped items do not constrain other dates eligible IDs; full dates retain products', () => {
  const raw = snapshot(DATES[0]);
  raw.items = [{ ...item(1), singleItemBatchDiscount: 12.5 }];
  raw.dates[0] = { date: DATES[0], maxItems: 0, itemIds: [1] };
  raw.dates[1].itemIds = [1, 2, 99];
  const checked = validateShopping(raw, DATES[0]);
  assert.equal(checked.items.length, 1);
  assert.equal(checked.items[0].singleItemBatchDiscount, 12.5);
  assert.deepEqual(checked.dates[1].itemIds, [1, 2, 99]);
  assert.equal(fitsDate(checked, DATES[0], [line(1)]), false);
  assert.equal(fitsDate(checked, DATES[1], [line(99)]), true);
  raw.items[0].singleItemBatchDiscount = 0;
  assert.equal(validateShopping(raw, DATES[0]).items[0].singleItemBatchDiscount, 0);
  raw.items = [];
  assert.deepEqual(validateShopping(raw, DATES[0]).items, []);
});

test('local additions enforce five total units rather than five per product without mutation', () => {
  const checked = validateShopping(snapshot());
  const four = basket([line(1, 2), line(2, 2)], DATES[0]);
  const before = structuredClone(four);
  assert.equal(additionProblem(checked, four, 1), '');
  assert.deepEqual(four, before);
  const five = basket([line(1, 3), line(2, 2)], DATES[0]);
  assert.equal(totalItems(five.lines), 5);
  assert.match(additionProblem(checked, five, 1), /unchanged.*five items total/i);
  assert.match(additionProblem(checked, five, 2), /unchanged.*five items total/i);
  assert.match(additionProblem(checked, basket([line(1, 99)]), 2), /five items total/i);
  assert.equal(basketReadiness(checked, five), '');
  assert.match(basketReadiness(checked, basket([line(1, 6)], DATES[0])), /kept in full.*five items/i);
});

test('one remaining slot permits just one unit and eligibility is independent of capacity', () => {
  const raw = snapshot();
  raw.dates.forEach(day => { day.maxItems = 0; });
  raw.dates[0] = { date: DATES[0], maxItems: 1, itemIds: [1] };
  const checked = validateShopping(raw);
  assert.equal(additionProblem(checked, basket([], DATES[0]), 1), '');
  assert.match(additionProblem(checked, basket([], DATES[0]), 2), /unavailable/);
  assert.match(additionProblem(checked, basket([line(1)], DATES[0]), 1), /unavailable/);
  assert.equal(fitsDate(checked, DATES[0], [line(1)]), true);
  assert.equal(fitsDate(checked, DATES[0], [line(1, 2)]), false);
  assert.equal(fitsDate(checked, DATES[1], [line(1)]), false);
  assert.equal(fitsDate(checked, '2026-12-01', [line(1)]), false);
  assert.equal(fitsDate(null, DATES[0], [line(1)]), false);
});

test('bread-first requires a single date fitting the whole basket, not separate eligible dates', () => {
  const raw = snapshot();
  raw.dates.forEach(day => { day.itemIds = []; });
  raw.dates[0].itemIds = [1];
  raw.dates[1].itemIds = [2];
  const checked = validateShopping(raw);
  assert.equal(additionProblem(checked, basket(), 1), '');
  assert.equal(additionProblem(checked, basket(), 2), '');
  const breadFirst = basket([line(1)]);
  assert.match(additionProblem(checked, breadFirst, 2), /whole basket/);
  assert.match(basketReadiness(checked, breadFirst), /Choose a delivery date.*whole basket/);
  raw.dates[2].itemIds = [1, 2];
  raw.dates[2].maxItems = 1;
  assert.match(additionProblem(validateShopping(raw), breadFirst, 2), /unavailable/);
  raw.dates[2].maxItems = 2;
  assert.equal(additionProblem(validateShopping(raw), breadFirst, 2), '');
});

test('date-first cannot silently switch dates to make a product or quantity fit', () => {
  const raw = snapshot();
  raw.dates[0] = { date: DATES[0], maxItems: 2, itemIds: [1] };
  const checked = validateShopping(raw);
  const dateFirst = basket([], DATES[0]);
  assert.equal(additionProblem(checked, dateFirst, 1), '');
  assert.match(additionProblem(checked, dateFirst, 2), /selected date or whole basket/);
  assert.equal(additionProblem(checked, basket([line(1)], DATES[0]), 1), '');
  assert.match(additionProblem(checked, basket([line(1, 2)], DATES[0]), 1), /unavailable/);
  const mixed = basket([line(1), line(2)], DATES[0]);
  assert.match(basketReadiness(checked, mixed), /unavailable for your whole basket/);
  assert.equal(basketReadiness(checked, { ...mixed, date: DATES[1] }), '');
  assert.deepEqual(dateFirst, basket([], DATES[0]));
  assert.match(additionProblem(null, mixed, 1), /unchanged.*rechecking/i);
  assert.match(basketReadiness(null, mixed), /rechecking.*not changed/i);
  assert.match(basketReadiness(checked, basket()), /Add a bake/);
});

test('merge adds matching IDs, sorts all lines, keeps inputs and prioritizes a fitting local date', () => {
  const checked = validateShopping(snapshot());
  const local = basket([line(2), line(1)], DATES[0]);
  const saved = basket([line(3), line(1)], DATES[1]);
  const raw = snapshot();
  raw.dates.forEach(day => { day.itemIds = [1, 2, 3]; });
  const before = structuredClone({ local, saved });
  const result = mergeBaskets(local, saved, validateShopping(raw));
  assert.deepEqual(result, basket([line(1, 2), line(2), line(3)], DATES[0]));
  assert.deepEqual({ local, saved }, before);
  assert.notEqual(result.lines[0], local.lines[1]);
  // The merged basket, not either original basket, must fit the chosen date.
  assert.equal(mergeBaskets(local, saved, checked).date, '');
  raw.dates[0].maxItems = 3;
  assert.equal(mergeBaskets(local, saved, validateShopping(raw)).date, DATES[1]);
  raw.dates[1].itemIds = [1, 2];
  assert.equal(mergeBaskets(local, saved, validateShopping(raw)).date, '');
  assert.equal(mergeBaskets(local, saved, null).date, '');
});

test('merge retains overflow including 99 + 99 without truncating, capping or dropping products', () => {
  const local = basket([line(2, 2), line(1, 99)], DATES[0]);
  const saved = basket([line(3, 99), line(1, 99)], DATES[1]);
  const before = structuredClone({ local, saved });
  const checked = validateShopping(snapshot());
  const merged = mergeBaskets(local, saved, checked);
  assert.deepEqual(merged, basket([line(1, 198), line(2, 2), line(3, 99)]));
  assert.equal(totalItems(merged.lines), 299);
  assert.deepEqual({ local, saved }, before);
  assert.match(basketReadiness(checked, merged), /kept in full.*bulk order/i);
  assert.match(additionProblem(checked, merged, 1), /Basket unchanged/);
  assert.equal(fitsDate(checked, DATES[0], merged.lines), false);
  const six = mergeBaskets(basket([line(1, 3)], DATES[0]), basket([line(1, 3)], DATES[1]), checked);
  assert.deepEqual(six, basket([line(1, 6)]), 'even a small overflow stays intact and loses its unfit date');
});

test('merge date priority uses local then saved but never invents a third fitting date', () => {
  const raw = snapshot();
  const local = basket([line(1)], DATES[0]);
  const saved = basket([line(2)], DATES[1]);
  assert.equal(mergeBaskets(local, saved, validateShopping(raw)).date, DATES[0]);
  raw.dates[0].itemIds = [1];
  assert.equal(mergeBaskets(local, saved, validateShopping(raw)).date, DATES[1]);
  raw.dates[1].maxItems = 1;
  assert.equal(fitsDate(validateShopping(raw), DATES[2], [line(1), line(2)]), true);
  assert.equal(mergeBaskets(local, saved, validateShopping(raw)).date, '');
  assert.equal(mergeBaskets(basket([line(1)]), basket([line(2)]), validateShopping(raw)).date, '');
});

test('estimates use integer paise and unitPrice only, never multiplying single-item batch previews', () => {
  const prices = new Map([
    [1, { ...item(1, 0.1), singleItemBatchDiscount: 90 }],
    [2, { ...item(2, 0.29), singleItemBatchDiscount: 40 }],
    [3, { ...item(3, 12.35), singleItemBatchDiscount: 0 }]
  ]);
  assert.equal(estimatePaise([], prices), 0);
  assert.equal(estimatePaise([line(1, 3), line(2, 2)], prices), 88);
  assert.equal(estimatePaise([line(2, 3)], prices), 87, 'round unit-price paise before quantity multiplication');
  assert.equal(estimatePaise([line(3, 3), line(1, 2)], prices), 3725);
  const mixed = [line(1, 2), line(2), line(3)];
  const before = structuredClone(mixed);
  const expected = estimatePaise(mixed, prices);
  prices.get(1).singleItemBatchDiscount = null;
  prices.get(2).singleItemBatchDiscount = 999999;
  prices.get(3).listPrice = 999999;
  assert.equal(estimatePaise(mixed, prices), expected);
  assert.deepEqual(mixed, before);
  assert.equal(estimatePaise([line(999)], prices), null, 'missing price is unavailable, not zero or a partial sum');
  assert.equal(estimatePaise([line(1), line(999)], prices), null);
  assert.equal(estimatePaise([line(1, 2)], new Map([[1, { unitPrice: Number.MAX_SAFE_INTEGER / 100 }]])), null);
  assert.equal(ESTIMATE_WARNING, 'Final total shown before payment.');
});