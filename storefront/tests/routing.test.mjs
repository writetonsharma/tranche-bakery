import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const origins = ['https://www.tranchebakery.in', 'https://tranchebakery.in'];
const otherOrigins = ['http://www.tranchebakery.in', 'http://tranchebakery.in',
  'https://www.tranchebakery.in:8443', 'http://localhost:8765', 'http://127.0.0.1:8765',
  'https://tranche-bakery.vercel.app', 'https://tranche-bakery-preview.vercel.app',
  'https://www.tranchebakery.in.attacker.example', 'https://other.tranchebakery.in', 'null'];
const paths = ['/api/catalog', '/api/session', '/api/quote', '/api/shopping',
  '/api/auth/challenge', '/api/auth/verify', '/api/auth/logout',
  '/api/cart', '/api/checkout/prepare', '/api/checkout', '/api/checkout/:opaqueId([A-Za-z0-9_-]{32})',
  '/api/account/profile', '/api/account/location', '/api/account/orders', '/api/account/checkout',
  '/api/account/orders/:opaqueId([A-Za-z0-9_-]{32})',
  '/api/subscriptions/plans', '/api/subscriptions/current', '/api/subscriptions', '/api/subscriptions/current/cancel'];
const backend = 'https://tranchewa-app-production.up.railway.app';
const configCode = () => readFile(new URL('../config.js', import.meta.url), 'utf8');
const routing = async () => JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('production UI enables only exact HTTPS bakery origins, never preview/local/lookalike origins', async () => {
  const code = await configCode();
  for (const origin of [...origins, ...otherOrigins]) {
    const context = { window: { location: { origin } } };
    vm.runInNewContext(code, context);
    assert.equal(context.window.TRANCHE_STOREFRONT.enabled, origins.includes(origin), origin);
    assert.equal(Object.isFrozen(context.window.TRANCHE_STOREFRONT), true);
  }
});

test('explicit pre-script rollback and local mock injections remain possible without persistent switches', async () => {
  const code = await configCode();
  for (const [origin, enabled] of [[origins[0], false], ['http://127.0.0.1:8765', true]]) {
    const injected = { enabled };
    const context = { window: { location: { origin }, TRANCHE_STOREFRONT: injected } };
    vm.runInNewContext(code, context);
    assert.equal(context.window.TRANCHE_STOREFRONT, injected);
  }
  assert.doesNotMatch(code, /localStorage|sessionStorage|URLSearchParams|location\.(search|hash)/);
});

test('Vercel proxies only exact customer/account routes and bounded opaque IDs to fixed HTTPS backend', async () => {
  const config = await routing();
  assert.deepEqual(config.rewrites.map(rule => rule.source).toSorted(), [...paths].toSorted());
  for (const rule of config.rewrites) {
    assert.equal(rule.destination, backend + rule.source.replace(':opaqueId([A-Za-z0-9_-]{32})', ':opaqueId'));
    assert.deepEqual(Object.keys(rule).toSorted(), ['destination', 'has', 'source']);
  }
  // No HTML routing, catch-all proxy, webhook, admin or provider endpoint.
  for (const key of ['routes', 'redirects', 'cleanUrls', 'trailingSlash', 'env', 'builds', 'functions']) {
    assert.equal(config[key], undefined);
  }
});

test('every external rewrite requires an exact live host, excluding Vercel preview hosts', async () => {
  const config = await routing();
  const hosts = origins.map(origin => new URL(origin).hostname);
  const denied = ['localhost', '127.0.0.1', 'tranche-bakery.vercel.app',
    'tranche-bakery-preview.vercel.app', 'other.tranchebakery.in',
    'www.tranchebakery.in.attacker.example', 'wwwXtranchebakeryXin', 'tranchebakery.in:8443'];
  for (const rule of config.rewrites) {
    assert.equal(rule.has.length, 1);
    const condition = rule.has[0];
    assert.equal(condition.type, 'host');
    const pattern = new RegExp(condition.value);
    for (const host of hosts) assert.equal(pattern.test(host), true, host);
    for (const host of denied) assert.equal(pattern.test(host), false, host);
  }
});

test('API proxy caching is disabled at browser, CDN and Vercel rewrite layers', async () => {
  const config = await routing();
  const rule = config.headers.find(rule => rule.source === '/api/:path*');
  assert.ok(rule);
  const headers = Object.fromEntries(rule.headers.map(header => [header.key.toLowerCase(), header.value]));
  assert.equal(headers['cache-control'], 'no-store, private');
  assert.equal(headers['cdn-cache-control'], 'no-store');
  assert.equal(headers['vercel-cdn-cache-control'], 'no-store');
  assert.equal(headers['x-vercel-enable-rewrite-caching'], '0');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  const assets = config.headers.find(rule => rule.source === '/storefront/:path*');
  assert.ok(assets.headers.some(header => header.key === 'Cache-Control' && header.value === 'no-store'));
});

test('approved checkout enables only on exact HTTPS production origins', async () => {
  const code = await configCode();
  for (const origin of [...origins, ...otherOrigins]) {
    const context = { window: { location: { origin } } }; vm.runInNewContext(code, context);
    assert.equal(context.window.TRANCHE_STOREFRONT.checkoutEnabled, origins.includes(origin));
  }
  const context = { window: {} }; vm.runInNewContext(code, context);
  assert.equal(context.window.TRANCHE_STOREFRONT.checkoutEnabled, false);
});

test('status rewrite rejects arbitrary IDs, extra paths, encodings and query injection', async () => {
  const config = await routing();
  const rule = config.rewrites.find(r => r.source.startsWith('/api/checkout/:'));
  assert.equal(rule.source, '/api/checkout/:opaqueId([A-Za-z0-9_-]{32})');
  const pattern = /^\/api\/checkout\/[A-Za-z0-9_-]{32}$/;
  assert.equal(pattern.test('/api/checkout/' + 'a'.repeat(32)), true);
  for (const path of ['/api/checkout/x', '/api/checkout/../admin', '/api/checkout/' + 'a'.repeat(33),
    '/api/checkout/%2fadmin', '/api/checkout/' + 'a'.repeat(32) + '/extra']) assert.equal(pattern.test(path), false);
});

test('account rewrites have no subtree wildcard or query-based path matching', async () => {
  const config = await routing();
  const rules = config.rewrites.filter(rule => rule.source.startsWith('/api/account'));
  assert.equal(rules.length, 5);
  const detail = rules.find(rule => rule.source.includes('/:'));
  assert.equal(detail.source, '/api/account/orders/:opaqueId([A-Za-z0-9_-]{32})');
  const pattern = new RegExp('^' + detail.source.replace(':opaqueId', '') + '$(?![\\s\\S])');
  for (const id of ['a'.repeat(32), '_-'.repeat(16)]) assert.equal(pattern.test('/api/account/orders/' + id), true);
  for (const suffix of ['1', 'a'.repeat(31), 'a'.repeat(33), '../profile', '%2fadmin',
    'a'.repeat(32) + '/extra', 'a'.repeat(32) + '?page=0', 'a'.repeat(32) + '\n']) {
    assert.equal(pattern.test('/api/account/orders/' + suffix), false, suffix);
  }
  // Vercel matches the path, not the page value: client and backend bound queries.
  assert.ok(rules.some(rule => rule.source === '/api/account/orders'));
  for (const rule of rules) assert.doesNotMatch(rule.source, /\?|:path|\*/);
});