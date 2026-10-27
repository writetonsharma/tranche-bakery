import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, StorefrontApi } from '../api.mjs';

const id = 'Ab09_-'.repeat(5) + 'xy';
const profile = () => ({ version: 0, name: 'Customer', address: 'A complete delivery address',
  deliveryPreference: 'DOOR', loafPreference: 'WHOLE' });
const session = token => ({ authenticated: true, customer: { id: 1 },
  csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: token });
const routes = ['/api/account/profile', '/api/account/orders', '/api/account/orders?page=0',
  '/api/account/orders?page=10000', `/api/account/orders/${id}`, '/api/account/checkout'];
function fixture(options = { checkoutEnabled: true }, response = { ok: true }) {
  const calls = [];
  const api = new StorefrontApi(async (path, init) => {
    calls.push({ path, init });
    return { ok: true, json: async () => response };
  }, options);
  return { api, calls };
}

test('account GETs use only exact same-origin paths, cookie transport and private fetch settings', async () => {
  const { api, calls } = fixture();
  for (const path of routes) await api.request(path, undefined, undefined, 'GET');
  assert.deepEqual(calls.map(call => call.path), routes);
  for (const { init } of calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    assert.equal(Object.hasOwn(init, 'body'), false);
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test('account gate is independent of login/preview and accepts only boolean checkoutEnabled true', async () => {
  for (const options of [{}, { enabled: true }, { checkoutEnabled: false },
    { checkoutEnabled: 'true' }, { checkoutEnabled: 1 }]) {
    const { api, calls } = fixture(options);
    api.useSession(session('private-token'));
    for (const path of routes) await assert.rejects(api.request(path), /Disallowed API route/);
    await assert.rejects(api.request('/api/account/profile', profile()), /Disallowed API route/);
    assert.equal(calls.length, 0);
    await api.request('/api/catalog');
    assert.equal(calls.length, 1);
  }
});

test('history accepts only omitted page or a single canonical integer within 0..10000', async () => {
  const { api, calls } = fixture();
  for (const page of ['0', '1', '9', '10', '999', '9999', '10000']) {
    await api.request('/api/account/orders?page=' + page);
  }
  assert.equal(calls.length, 7);
  calls.length = 0;
  for (const query of ['?', '?page=', '?page=00', '?page=01', '?page=-1', '?page=+1', '?page=1.0',
    '?page=1e2', '?page=10001', '?page=100000', '?page= 1', '?page=%31', '?page=1%20',
    '?page=1&page=2', '?page[]=1', '?page[0]=1', '?Page=1', '?size=10', '?page=1&size=10',
    '?page=1&', '?page=1#fragment', '?page=1\n', '?page=1\r\n', '?page=１']) {
    await assert.rejects(api.request('/api/account/orders' + query), /Disallowed API route/);
  }
  assert.equal(calls.length, 0);
});

test('account paths reject origin, identity, encoding, traversal, trailing slash and query injection', async () => {
  const { api, calls } = fixture();
  const denied = ['/api/account', '/api/account/', '/api/account/anything', '/api/account/profile/',
    '/api/account/profile?customerId=1', '/api/account/profile#x', '/api/account/checkout/',
    '/api/account/checkout?orderId=1', '/api/account/orders/', '/api/account/orders/1',
    '/api/account/orders/' + 'a'.repeat(31), '/api/account/orders/' + 'a'.repeat(33),
    '/api/account/orders/' + 'é'.repeat(32), '/api/account/orders/%2fadmin',
    '/api/account/orders/../profile', `/api/account/orders/${id}/extra`,
    `/api/account/orders/${id}?page=0`, `/api/account/orders/${id}\n`,
    'https://tranchewa-app-production.up.railway.app/api/account/profile',
    '//tranchebakery.in/api/account/profile', '/api/account/Profile', null, {}, 1];
  for (const path of denied) await assert.rejects(api.request(path), /Disallowed API route/);
  assert.equal(calls.length, 0);
});

test('account methods and read bodies fail closed before fetch, even after bootstrap', async () => {
  const { api, calls } = fixture();
  api.useSession(session('private-token'));
  for (const path of routes) {
    for (const method of ['POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'get', '', null, false]) {
      await assert.rejects(api.request(path, undefined, undefined, method), /Disallowed API method/);
    }
    await assert.rejects(api.request(path, {}, undefined, 'GET'), /Disallowed API body/);
    if (path !== '/api/account/profile') {
      await assert.rejects(api.request(path, profile(), undefined, 'PUT'), /Disallowed API method/);
      await assert.rejects(api.request(path, profile()), /Disallowed API body/);
    }
  }
  assert.equal(calls.length, 0);
});

test('profile PUT requires bootstrap, carries only bounded profile fields and rotates/clears CSRF', async () => {
  const { api, calls } = fixture({}, session('first-token'));
  // This fixture deliberately starts with the account gate off; bootstrap alone cannot enable it.
  await api.session();
  await assert.rejects(api.request('/api/account/profile', profile()), /Disallowed API route/);
  assert.equal(calls.length, 1);

  const enabled = fixture({ checkoutEnabled: true }, session('first-token'));
  await assert.rejects(enabled.api.request('/api/account/profile', profile()), /Session bootstrap required/);
  assert.equal(enabled.calls.length, 0);
  await enabled.api.session();
  for (const [token, method] of [['first-token', undefined], ['rotated-token', 'PUT']]) {
    if (token === 'rotated-token') enabled.api.useSession(session(token));
    await enabled.api.request('/api/account/profile', { ...profile(), name: ' Customer ',
      address: ' A complete delivery address ' }, undefined, method);
    const { path, init } = enabled.calls.at(-1);
    assert.equal(path, '/api/account/profile');
    assert.equal(init.method, 'PUT');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { Accept: 'application/json', 'X-XSRF-TOKEN': token,
      'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(init.body), profile());
  }
  enabled.api.clearSession();
  await assert.rejects(enabled.api.request('/api/account/profile', profile()), /Session bootstrap required/);
  assert.equal(enabled.calls.length, 3);
});

test('profile PUT rejects missing/extra fields, invalid versions, unsafe text and preference coercion', async () => {
  const { api, calls } = fixture();
  api.useSession(session('private-token'));
  const invalid = [undefined, null, [], 'profile', {}, { ...profile(), phone: 'private' },
    { ...profile(), customerId: 1 }, Object.assign(Object.create({}), profile())];
  for (const key of Object.keys(profile())) {
    const missing = profile(); delete missing[key]; invalid.push(missing);
    invalid.push({ ...profile(), [key]: null });
  }
  for (const version of [-1, 0.5, '0', true, Number.MAX_SAFE_INTEGER, Infinity, NaN]) invalid.push({ ...profile(), version });
  for (const name of ['', ' ', 'a'.repeat(101), 123, {}, 'a\nb', '\tCustomer', 'a\u0085b', 'a\u2028b']) invalid.push({ ...profile(), name });
  for (const address of ['short', 'a'.repeat(2001), '\nA complete delivery address', 'Address\u2029here', 'Address\u0000here']) invalid.push({ ...profile(), address });
  for (const deliveryPreference of ['', 'door', ['DOOR'], true]) invalid.push({ ...profile(), deliveryPreference });
  for (const loafPreference of ['', 'whole', ['WHOLE'], 1]) invalid.push({ ...profile(), loafPreference });
  for (const body of invalid) await assert.rejects(api.request('/api/account/profile', body, undefined, 'PUT'), /Invalid profile/);
  assert.equal(calls.length, 0);
  await api.request('/api/account/profile', { ...profile(), version: Number.MAX_SAFE_INTEGER - 1 }, undefined, 'PUT');
  assert.equal(calls.length, 1);
});

test('account and checkout errors retain only allowlisted codes, never server text or submitted PII', async () => {
  const secret = 'PRIVATE name address phone token provider diagnostics';
  for (const path of ['/api/account/profile', '/api/account/orders', '/api/account/checkout', '/api/checkout/' + id]) {
    for (const candidate of ['PROFILE_CONFLICT', 'CHECKOUT_NOT_FOUND', 'INVALID_REQUEST', secret, '__proto__', 'X'.repeat(49)]) {
      const api = new StorefrontApi(async () => ({ ok: false, status: 409,
        json: async () => ({ message: secret, problems: [{ code: candidate, message: secret }], customer: secret }) }),
      { checkoutEnabled: true });
      await assert.rejects(api.request(path), error => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.equal(error.code, ['PROFILE_CONFLICT', 'CHECKOUT_NOT_FOUND', 'INVALID_REQUEST'].includes(candidate) ? candidate : undefined);
        assert.doesNotMatch(JSON.stringify(error) + error.message + error.stack, /PRIVATE/);
        assert.deepEqual(Object.keys(error).sort(), ['code', 'status']);
        return true;
      });
    }
  }
});

test('empty/HTML security errors are generic and non-account authentication payloads are never parsed', async () => {
  for (const path of ['/api/account/profile', '/api/account/checkout']) {
    const api = new StorefrontApi(async () => ({ ok: false, status: 403,
      json: async () => { throw new SyntaxError('PRIVATE HTML'); } }), { checkoutEnabled: true });
    await assert.rejects(api.request(path), error => error instanceof ApiError && error.status === 403 &&
      error.code === undefined && !error.message.includes('PRIVATE'));
  }
  let parsed = false;
  const api = new StorefrontApi(async () => ({ ok: false, status: 401,
    json: async () => { parsed = true; return { problems: [{ code: 'PROFILE_CONFLICT' }] }; } }), { checkoutEnabled: true });
  api.useSession(session('private-token'));
  await assert.rejects(api.request('/api/auth/challenge', { phone: 'private' }), ApiError);
  assert.equal(parsed, false);
});