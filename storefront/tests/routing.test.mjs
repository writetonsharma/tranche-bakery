import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const origins = ['https://www.tranchebakery.in', 'https://tranchebakery.in'];
const otherOrigins = ['http://www.tranchebakery.in', 'http://tranchebakery.in',
  'https://www.tranchebakery.in:8443', 'http://localhost:8765', 'http://127.0.0.1:8765',
  'https://tranche-bakery.vercel.app', 'https://tranche-bakery-preview.vercel.app',
  'https://www.tranchebakery.in.attacker.example', 'https://other.tranchebakery.in', 'null'];
const paths = ['/api/catalog', '/api/session', '/api/quote',
  '/api/auth/challenge', '/api/auth/verify', '/api/auth/logout'];
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

test('Vercel proxies exactly the six existing customer API paths to the fixed HTTPS backend', async () => {
  const config = await routing();
  assert.deepEqual(config.rewrites.map(rule => rule.source).toSorted(), [...paths].toSorted());
  for (const rule of config.rewrites) {
    assert.equal(rule.destination, backend + rule.source);
    assert.deepEqual(Object.keys(rule).toSorted(), ['destination', 'has', 'source']);
  }
  // No new HTML routing, catch-all proxy, checkout, webhook, admin or provider endpoint.
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