import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, profileInput, validateHistory, validateOrderDetail } from '../account-model.mjs';
import { AccountController, attachAccount } from '../account.mjs';

const now = Date.parse('2026-10-27T08:00:00Z');
const id = 'a'.repeat(32);
const profile = { version: 0, name: 'Test Customer', address: '123 Example Street, Gurugram', deliveryPreference: 'GATE', loafPreference: 'WHOLE' };
const quote = { lines: [{ itemId: 99, name: 'Retired bread', quantity: 2, unitPrice: 100, lineTotal: 200 }],
  listSubtotal: 200, discountAmount: 0, discountLabel: null, batchDiscountAmount: 0, batchDiscountLabel: null,
  deliveryCharge: 50, giftLabel: null, creditApplied: 0, totalAmount: 250, itemCount: 2, date: '2026-10-01', valid: true, problems: [] };
const detail = { id, orderNumber: 'WEB-123', createdAt: '2026-09-30T08:00:00Z', orderStatus: 'CONFIRMED',
  status: 'PAID', paymentUrl: null, expiresAt: '2026-09-30T08:10:00Z',
  fulfillment: { name: profile.name, address: profile.address, deliveryPreference: 'GATE', loafPreference: 'WHOLE' }, quote };
const summary = { id, orderNumber: detail.orderNumber, createdAt: detail.createdAt,
  deliveryDate: quote.date, orderStatus: detail.orderStatus, status: detail.status, totalAmount: quote.totalAmount };
const history = { orders: [summary], page: 0, hasMore: false };
const session = { authenticated: true, customer: { id: 7 } };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(handler = () => undefined) {
  const calls = [];
  const api = {
    clearSession() {}, useSession(value) { return value; },
    async request(path, body, signal, method) {
      calls.push({ path, body, signal, method });
      const override = handler(path, body, signal, method);
      if (override !== undefined) return override;
      if (path === '/api/session') return structuredClone(session);
      if (path === '/api/account/profile') return structuredClone(profile);
      if (path.startsWith('/api/account/orders?page=')) return { ...structuredClone(history), page: Number(path.split('=')[1]) };
      if (path === `/api/account/orders/${id}`) return structuredClone(detail);
      throw new Error('Unexpected route');
    }
  };
  const controller = new AccountController({ api, now: () => now });
  return { api, calls, controller };
}

test('profile exact schema, empty GET suggestions and explicit safe PUT rules', () => {
  assert.deepEqual(validateProfile(profile), profile);
  assert.ok(Object.isFrozen(validateProfile(profile)));
  assert.equal(validateProfile({ ...profile, name: '', address: '', deliveryPreference: '', loafPreference: '' }).name, '');
  assert.equal(profileInput({ ...profile, name: '  Test Customer  ' }).name, 'Test Customer');
  for (const version of ['0', -1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateProfile({ ...profile, version }));
  assert.equal(validateProfile({ ...profile, version: Number.MAX_SAFE_INTEGER }).version, Number.MAX_SAFE_INTEGER);
  assert.throws(() => profileInput({ ...profile, version: Number.MAX_SAFE_INTEGER }));
  for (const bad of [null, [], { ...profile, phone: 'private' }, { ...profile, name: null }, { ...profile, name: 'x'.repeat(101) },
    { ...profile, address: 'x'.repeat(2001) }, { ...profile, deliveryPreference: 'door' }, { ...profile, loafPreference: false }]) {
    assert.throws(() => validateProfile(bad));
  }
  for (const key of ['name', 'address', 'deliveryPreference', 'loafPreference', 'version']) {
    const missing = { ...profile }; delete missing[key]; assert.throws(() => validateProfile(missing));
  }
  for (const char of ['\n', '\r', '\t', '\0', '\u007f', '\u0085', '\u2028', '\u2029']) {
    for (const key of ['name', 'address']) assert.throws(() => profileInput({ ...profile, [key]: profile[key] + char }));
  }
  for (const bad of [{ name: '' }, { address: 'short' }, { deliveryPreference: '' }, { loafPreference: '' }]) assert.throws(() => profileInput({ ...profile, ...bad }));
});

test('normalized or omitted legacy suggestions bootstrap history and remain explicitly editable', async () => {
  for (const suggestions of [
    { name: 'Shared Name Example', address: 'Flat 42, Account Lane Gurugram India' },
    { name: '', address: '' },
    { name: 'N'.repeat(100), address: 'A'.repeat(2000) }
  ]) {
    const projected = { version: 0, ...suggestions, deliveryPreference: '', loafPreference: '' };
    const { controller, calls } = fixture(path => path === '/api/account/profile' ? structuredClone(projected) : undefined);
    await controller.refresh();
    assert.deepEqual(controller.state.profile, projected);
    assert.deepEqual(controller.state.history, history);
    assert.equal(calls.every(call => call.body === undefined && call.method === undefined), true);
    const edited = profileInput({ ...controller.state.profile,
      name: suggestions.name || 'Edited Name', address: suggestions.address || profile.address,
      deliveryPreference: 'GATE', loafPreference: 'WHOLE' });
    assert.equal(edited.version, 0);
    assert.equal(edited.name, suggestions.name || 'Edited Name');
    assert.equal(edited.address, suggestions.address || profile.address);
  }
});

test('history is ten-per-page exact, private-field free, opaque and immutable', () => {
  const value = validateHistory(history, 0);
  assert.ok(Object.isFrozen(value.orders[0]));
  assert.equal(value.orders[0].totalAmount, 250);
  const full = Array.from({ length: 10 }, (_, index) => ({ ...summary, id: String(index).repeat(32) }));
  assert.equal(validateHistory({ orders: full, page: 10000, hasMore: true }, 10000).orders.length, 10);
  for (const bad of [{ ...history, page: '0' }, { ...history, page: -1 }, { ...history, page: 10001 },
    { ...history, hasMore: true }, { ...history, orders: [...full, summary] }, { ...history, orders: [summary, summary] },
    { ...history, phone: 'private' }]) assert.throws(() => validateHistory(bad, 0));
  for (const patch of [{ id: '../cart' }, { id: 123 }, { deliveryDate: '2026-02-30' }, { totalAmount: '250' },
    { totalAmount: -1 }, { orderStatus: 'DRAFT' }, { status: 'SUCCESS' }, { createdAt: 'yesterday' },
    { createdAt: '2026-02-30T08:00:00Z' }, { address: profile.address }]) {
    assert.throws(() => validateHistory({ ...history, orders: [{ ...summary, ...patch }] }));
  }
  assert.throws(() => validateHistory(history, 1));
});

test('detail retains immutable original fulfillment, retired quote and validated checkout', () => {
  const input = structuredClone(detail);
  const value = validateOrderDetail(input, id, now);
  assert.equal(value.quote.lines[0].itemId, 99);
  assert.equal(value.status, 'PAID');
  assert.ok(Object.isFrozen(value.fulfillment));
  assert.ok(Object.isFrozen(value.quote.lines[0]));
  input.fulfillment.address = 'Changed address'; input.quote.lines[0].name = 'Changed bread';
  assert.equal(value.fulfillment.address, profile.address);
  assert.equal(value.quote.lines[0].name, 'Retired bread');
  assert.throws(() => validateOrderDetail(detail, 'b'.repeat(32), now));
  for (const char of ['\u2028', '\u2029']) assert.throws(() => validateOrderDetail({ ...detail, fulfillment: { ...detail.fulfillment, address: profile.address + char } }, id, now));
  for (const patch of [{ phone: 'private' }, { paymentUrl: 'https://rzp.io/a' }, { fulfillment: { ...detail.fulfillment, phone: 'private' } },
    { quote: { ...quote, totalAmount: '250' } }, { quote: { ...quote, itemCount: 3 } }, { quote: { ...quote, valid: false } },
    { quote: { ...quote, providerId: 'private' } }, { quote: { ...quote, problems: [{ code: 'X', message: 'private' }] } }]) {
    assert.throws(() => validateOrderDetail({ ...detail, ...patch }, id, now));
  }
});

test('account uncertain states survive expiry, only safe live PAYABLE exposes URL', () => {
  for (const status of ['CREATING', 'UNKNOWN']) {
    const value = validateOrderDetail({ ...detail, status }, id, now);
    assert.equal(value.status, status); assert.equal(value.paymentUrl, null);
  }
  const payable = { ...detail, status: 'PAYABLE', paymentUrl: 'https://rzp.io/i/test', expiresAt: '2026-10-28T08:00:00Z' };
  assert.equal(validateOrderDetail(payable, id, now).paymentUrl, payable.paymentUrl);
  assert.equal(validateOrderDetail({ ...payable, expiresAt: detail.expiresAt }, id, now).status, 'EXPIRED');
  for (const paymentUrl of [null, 'https://evil.test/pay', 'https://rzp.io:443/a', 'https://rzp.io/a#x']) {
    assert.throws(() => validateOrderDetail({ ...payable, paymentUrl }, id, now));
    assert.throws(() => validateOrderDetail({ ...payable, paymentUrl, expiresAt: detail.expiresAt }, id, now));
  }
});

test('GET loading never saves or alters basket; detail and pagination only read exact routes', async () => {
  const { controller, calls } = fixture();
  await controller.refresh(); await controller.page(1); await controller.detail(id);
  assert.equal(controller.state.detail.quote.totalAmount, 250);
  assert.ok(calls.every(call => call.body === undefined && call.method === undefined));
  assert.ok(calls.every(call => call.path === '/api/session' || call.path.startsWith('/api/account/')));
  const count = calls.length; await controller.detail('../cart'); await controller.page('1');
  assert.equal(calls.length, count);
});

test('explicit save uses version, conflict retains profile and blocks retry until chosen reload', async () => {
  let conflict = true;
  const { controller, calls } = fixture((path, body, signal, method) => {
    if (method === 'PUT') {
      if (conflict) throw Object.assign(new Error('Do not expose private server text'), { status: 409 });
      return { ...body, version: body.version + 1 };
    }
  });
  await controller.refresh();
  const edits = { ...detail.fulfillment, name: 'Edited customer' };
  await controller.save(edits);
  assert.equal(controller.state.conflict, true); assert.equal(controller.state.profile.name, profile.name);
  assert.doesNotMatch(controller.state.message, /private server text/);
  await controller.save(edits); assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  await controller.reloadProfile(); conflict = false;
  await controller.save(edits); assert.equal(controller.state.profile.name, edits.name);
  assert.equal(controller.state.profile.version, 1);
});

test('privacy clear aborts and rejects late profile/detail responses even when API ignores abort', async () => {
  const pending = deferred();
  const { controller, calls } = fixture(path => path === '/api/account/profile' ? pending.promise : undefined);
  const loading = controller.refresh(); await Promise.resolve(); await Promise.resolve();
  controller.clear();
  assert.ok(calls.find(call => call.path === '/api/account/profile').signal.aborted);
  pending.resolve(profile); await loading;
  assert.equal(controller.state.profile, null); assert.equal(controller.state.history, null);
  assert.equal(controller.state.authenticated, false);
});

test('identity changes clear private model before any account write; authentication failures clear all', async () => {
  let identity = 7;
  const { controller, calls } = fixture(path => path === '/api/session' ? { ...session, customer: { id: identity } } : undefined);
  await controller.refresh(); identity = 8; await controller.save(detail.fulfillment);
  assert.equal(controller.state.profile, null); assert.equal(controller.state.authenticated, false);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
  const failed = fixture((path, body, signal, method) => {
    if (method === 'PUT') throw Object.assign(new Error('private'), { status: 401 });
  });
  await failed.controller.refresh(); await failed.controller.save(detail.fulfillment);
  assert.equal(failed.controller.state.profile, null); assert.equal(failed.controller.state.detail, null);
});

// Minimal dependency-free DOM. Retains removed input references to verify wiping,
// rather than accepting hidden nodes as a privacy boundary.
class FakeNode extends EventTarget {
  children = []; attributes = {}; value = ''; defaultValue = ''; hidden = false; disabled = false; ownText = '';
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); }
  set textContent(value) { this.ownText = value; this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.ownText = ''; this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelectorAll(selector) {
    const tags = selector.split(',').map(value => value.trim().toUpperCase());
    return this.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
function fakePage(api) {
  const nodes = Object.fromEntries(['account-private', 'account-status', 'account-signin', 'account-recheck', 'account-logout'].map(key => [key, new FakeNode()]));
  const doc = new EventTarget(); doc.hidden = false;
  doc.createElement = tag => new FakeNode(tag); doc.getElementById = key => nodes[key];
  const win = new EventTarget(); win.navigator = { onLine: true };
  // Throw if account code ever attempts browser persistence.
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(win, name, { get() { throw new Error('No private persistence'); } });
  class Channel { static current; constructor() { Channel.current = this; } postMessage() {} close() {} }
  win.BroadcastChannel = Channel;
  const view = attachAccount({ root: nodes['account-private'], api, win, doc });
  return { ...view, win, doc, nodes, channel: Channel.current };
}

test('hidden, offline, cross-tab, pagehide and logout synchronously wipe DOM input values and model', async () => {
  for (const transition of ['hidden', 'offline', 'identity', 'pagehide', 'logout']) {
    const { api } = fixture(); const page = fakePage(api);
    await page.controller.refresh();
    const root = page.nodes['account-private'];
    const inputs = root.querySelectorAll('input, select');
    assert.ok(inputs.some(input => input.value === profile.address));
    inputs[0].value = 'Unsaved private edit';
    if (transition === 'hidden') { page.doc.hidden = true; page.doc.dispatchEvent(new Event('visibilitychange')); }
    if (transition === 'offline') { page.win.navigator.onLine = false; page.win.dispatchEvent(new Event('offline')); }
    if (transition === 'identity') page.channel.onmessage({ data: 'identity-changed' });
    if (transition === 'pagehide') page.win.dispatchEvent(new Event('pagehide'));
    if (transition === 'logout') page.nodes['account-logout'].dispatchEvent(new Event('click'));
    assert.ok(inputs.every(input => input.value === '' && input.defaultValue === ''));
    assert.equal(root.textContent, ''); assert.equal(root.hidden, true);
    assert.equal(page.controller.state.profile, null); assert.equal(page.controller.state.history, null);
    page.destroy();
  }
});

test('409 DOM preserves unsaved edits; explicit reload replaces them; visible/focus rechecks session', async () => {
  const { api, calls } = fixture((path, body, signal, method) => {
    if (method === 'PUT') throw Object.assign(new Error('Conflict'), { status: 409 });
  });
  const page = fakePage(api); await page.controller.refresh();
  const root = page.nodes['account-private'];
  const input = root.querySelectorAll('input')[0]; input.value = 'Unsaved private edit';
  await page.controller.save({ ...detail.fulfillment, name: input.value });
  assert.equal(input.value, 'Unsaved private edit');
  assert.ok(root.querySelectorAll('button').find(button => button.textContent === 'Save website defaults').disabled);
  await page.controller.reloadProfile(); assert.equal(input.value, profile.name);
  const before = calls.filter(call => call.path === '/api/session').length;
  page.win.dispatchEvent(new Event('focus')); assert.equal(root.textContent, '');
  await Promise.resolve(); await Promise.resolve();
  assert.ok(calls.filter(call => call.path === '/api/session').length > before);
  page.destroy();
});

test('late historical detail cannot repopulate cleared model', async () => {
  const pending = deferred();
  const { controller, calls } = fixture(path => path === `/api/account/orders/${id}` ? pending.promise : undefined);
  await controller.refresh();
  const loading = controller.detail(id); await Promise.resolve(); await Promise.resolve();
  controller.clear('Offline');
  assert.ok(calls.find(call => call.path === `/api/account/orders/${id}`).signal.aborted);
  pending.resolve(detail); await loading;
  assert.equal(controller.state.detail, null); assert.equal(controller.state.profile, null);
});