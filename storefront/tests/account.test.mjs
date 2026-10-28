import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, profileInput, validateHistory, validateOrderDetail, validateLocation } from '../account-model.mjs';
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
const summary = { id, channel: 'WEB', orderNumber: detail.orderNumber, createdAt: detail.createdAt,
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
      if (path === '/api/account/location') return { latitude: null, longitude: null };
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
    assert.deepEqual(controller.state.history, history, 'first history page loads with the account');
    await controller.page(0);
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

const whatsapp = { id: null, channel: 'WHATSAPP', orderNumber: 'TR-2610-0042', createdAt: '2026-10-26T04:30:00Z',
  deliveryDate: '2026-10-27', orderStatus: 'COMPLETED', status: null, totalAmount: 345 };

test('history accepts summary-only WhatsApp rows and legacy channel-less website rows', () => {
  const value = validateHistory({ ...history, orders: [summary, whatsapp] }, 0);
  assert.deepEqual(value.orders[1], whatsapp);
  assert.equal(validateHistory({ ...history, orders: [{ ...whatsapp, deliveryDate: null, totalAmount: null }] }).orders[0].totalAmount, null);
  const legacy = { ...summary }; delete legacy.channel;
  assert.equal(validateHistory({ ...history, orders: [legacy] }).orders[0].channel, 'WEB');
  for (const patch of [{ id }, { status: 'PAID' }, { orderStatus: 'DRAFT' }, { deliveryDate: '2026-02-30' },
    { totalAmount: '345' }, { orderNumber: '' }, { createdAt: 'yesterday' }, { channel: 'SMS' }, { address: profile.address }]) {
    assert.throws(() => validateHistory({ ...history, orders: [{ ...whatsapp, ...patch }] }));
  }
  for (const patch of [{ channel: null }, { channel: 'SMS' }, { id: null }]) {
    assert.throws(() => validateHistory({ ...history, orders: [{ ...summary, ...patch }] }));
  }
  const noChannel = { ...whatsapp }; delete noChannel.channel;
  assert.throws(() => validateHistory({ ...history, orders: [noChannel] }));
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

test('signed-out account page signs in with WhatsApp in place, then loads profile and history', async () => {
  let authed = false;
  const { api, calls } = fixture(path => {
    if (path === '/api/session') return { authenticated: authed, customer: authed ? { id: 7 } : null };
    if (path === '/api/auth/challenge') return { challengeId: 'fixture-challenge', expiresInSeconds: 300 };
    if (path === '/api/auth/verify') { authed = true; return structuredClone(session); }
    return undefined;
  });
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  const page = fakePage(api);
  await page.controller.refresh();
  assert.equal(page.controller.state.profile, null);
  const signin = page.nodes['account-signin'];
  assert.equal(signin.hidden, false);
  const [form] = signin.children;
  const [phoneLabel, send, codeLabel, verify, note] = form.children;
  const [phone] = phoneLabel.children, [code] = codeLabel.children;
  assert.equal(codeLabel.hidden, true);
  phone.value = '12345';
  send.dispatchEvent(new Event('click')); await settle();
  assert.equal(calls.some(call => call.path === '/api/auth/challenge'), false, 'invalid numbers never request a code');
  phone.value = '9876543210';
  send.dispatchEvent(new Event('click')); await settle();
  assert.deepEqual(calls.find(call => call.path === '/api/auth/challenge').body, { phone: '919876543210' });
  assert.equal(phone.value, '');
  assert.equal(codeLabel.hidden, false); assert.equal(verify.hidden, false);
  assert.equal(send.disabled, true, 'resend is throttled');
  code.value = '123456';
  form.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
  assert.deepEqual(calls.find(call => call.path === '/api/auth/verify').body, { challengeId: 'fixture-challenge', code: '123456' });
  assert.equal(note.textContent, '');
  assert.equal(signin.hidden, true);
  assert.deepEqual(page.controller.state.profile, profile);
  assert.deepEqual(page.controller.state.history, history);
  page.destroy();
});

test('account sign-in still verifies after leaving for WhatsApp, which rechecks the page and drops CSRF', async () => {
  let authed = false, csrf;
  const { api, calls } = fixture(path => {
    if (path === '/api/session') return { authenticated: authed, customer: authed ? { id: 7 } : null };
    if (path === '/api/auth/challenge') return { challengeId: 'fixture-challenge', expiresInSeconds: 300 };
    if (path === '/api/auth/verify') { authed = true; return structuredClone(session); }
    return undefined;
  });
  // Model the real client: clearing forgets CSRF and unsafe requests need it.
  const request = api.request.bind(api);
  Object.assign(api, {
    clearSession() { csrf = undefined; },
    useSession(value) { csrf = 'token'; return value; },
    async request(path, body, signal, method) {
      if (path.startsWith('/api/auth/') && !csrf) throw new Error('Session bootstrap required');
      return request(path, body, signal, method);
    }
  });
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  const page = fakePage(api);
  await settle();
  const [form] = page.nodes['account-signin'].children;
  const [phoneLabel, send, codeLabel, , note] = form.children;
  phoneLabel.children[0].value = '9876543210';
  send.dispatchEvent(new Event('click')); await settle();
  page.doc.hidden = true; page.doc.dispatchEvent(new Event('visibilitychange')); await settle();
  page.doc.hidden = false; page.doc.dispatchEvent(new Event('visibilitychange')); await settle();
  assert.equal(csrf, undefined, 'the signed-out recheck clears the session token');
  codeLabel.children[0].value = '123456';
  form.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
  assert.equal(calls.filter(call => call.path === '/api/auth/verify').length, 1);
  assert.equal(note.textContent, '');
  assert.deepEqual(page.controller.state.profile, profile);
  page.destroy();
});

test('account sign-in explains a mistyped code and a send limit without dropping the code challenge', async () => {
  let verifyStatus = 400, challengeStatus = 0;
  const { api } = fixture(path => {
    if (path === '/api/session') return { authenticated: false, customer: null };
    if (path === '/api/auth/challenge') {
      if (challengeStatus) throw Object.assign(new Error('limited'), { status: challengeStatus });
      return { challengeId: 'fixture-challenge', expiresInSeconds: 300 };
    }
    if (path === '/api/auth/verify') throw Object.assign(new Error('rejected'), { status: verifyStatus });
    return undefined;
  });
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  const page = fakePage(api);
  await settle();
  const [form] = page.nodes['account-signin'].children;
  const [phoneLabel, send, codeLabel, verify, note] = form.children;
  phoneLabel.children[0].value = '9876543210';
  send.dispatchEvent(new Event('click')); await settle();
  codeLabel.children[0].value = '111111';
  form.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
  assert.match(note.textContent, /^That code did not work\. Use the latest code/);
  assert.equal(verify.hidden, false, 'the same code can be retried');
  page.destroy();

  challengeStatus = 429;
  const limited = fakePage(api);
  await settle();
  const [limitedForm] = limited.nodes['account-signin'].children;
  limitedForm.children[0].children[0].value = '9876543210';
  limitedForm.children[1].dispatchEvent(new Event('click')); await settle();
  assert.match(limitedForm.children[4].textContent, /Too many codes requested\. Please wait 15 minutes/);
  limited.destroy();
});

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
  assert.match(page.nodes['account-status'].textContent, /Saved details changed elsewhere.*edits are kept.*Reload to discard edits/);
  assert.doesNotMatch(page.nodes['account-status'].textContent, /version|CAS|server|backend/);
  assert.ok(root.querySelectorAll('button').find(button => button.textContent === 'Save details').disabled);
  await page.controller.reloadProfile(); assert.equal(input.value, profile.name);
  const before = calls.filter(call => call.path === '/api/session').length;
  const loaded = root.textContent;
  page.win.dispatchEvent(new Event('focus')); assert.equal(root.textContent, loaded, 'same-identity focus keeps loaded data');
  await Promise.resolve(); await Promise.resolve();
  assert.ok(calls.filter(call => call.path === '/api/session').length > before);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(page.controller.state.history.orders.length, 1);
  assert.match(root.textContent, /WEB-123/);
  page.destroy();
});

test('focus recheck clears everything when the signed-in identity changed or signed out', async () => {
  for (const next of [{ authenticated: true, customer: { id: 8 } }, { authenticated: false }]) {
    let current = session;
    const { api } = fixture(path => path === '/api/session' ? structuredClone(current) : undefined);
    const page = fakePage(api); await page.controller.refresh();
    assert.ok(page.controller.state.history);
    current = next;
    await page.controller.refresh();
    assert.equal(page.controller.state.profile, null); assert.equal(page.controller.state.history, null);
    assert.equal(page.nodes['account-private'].textContent, '');
    page.destroy();
  }
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

test('account uses customer language while preserving uncertain-payment guidance and read-only history', async () => {
  const { api, calls } = fixture(path => path === `/api/account/orders/${id}` ? { ...detail, status: 'UNKNOWN' } : undefined);
  const page = fakePage(api);
  try {
    await page.controller.refresh();
    await page.controller.page(0);
    await page.controller.detail(id);
    const text = page.nodes['account-private'].textContent;
    assert.match(text, /Save details/);
    assert.ok(page.nodes['account-private'].querySelectorAll('button')
      .find(button => button.textContent === 'Discard changes and load saved details').hidden);
    assert.match(text, /Confirmed/);
    assert.match(text, /Payment outcome uncertain/);
    assert.match(text, /before ordering or paying again/);
    assert.match(text, /Returning from payment does not confirm it/);
    assert.doesNotMatch(text, /server|backend|quote|snapshot|version|CSRF|CAS|PENDING|CONFIRMED|IN_PERSON/);
    assert.equal(calls.some(call => call.method === 'PUT' || call.path.startsWith('/api/checkout')), false);
  } finally { page.destroy(); }
});

test('WhatsApp history rows render as summaries without a detail action', async () => {
  const { api } = fixture(path => path.startsWith('/api/account/orders?page=')
    ? { ...structuredClone(history), orders: [summary, whatsapp, { ...whatsapp, orderNumber: 'TR-NO-TOTAL', deliveryDate: null, totalAmount: null }] }
    : undefined);
  const page = fakePage(api);
  try {
    await page.controller.refresh();
    const rows = page.nodes['account-private'].querySelectorAll('article');
    const [web, wa, bare] = rows;
    assert.equal(rows.length, 3);
    assert.ok(web.querySelectorAll('button').some(button => button.textContent === 'View original order'));
    assert.equal(wa.querySelectorAll('button').length, 0);
    assert.match(wa.textContent, /Order TR-2610-0042/);
    assert.match(wa.textContent, /Placed 2026-10-26 · Delivery 2026-10-27/);
    assert.match(wa.textContent, /Ordered on WhatsApp · Completed/);
    assert.match(wa.textContent, /345/);
    assert.doesNotMatch(bare.textContent, /Delivery|₹|null|undefined/);
    assert.match(page.nodes['account-private'].textContent, /Website and WhatsApp orders/);
  } finally { page.destroy(); }
});

test('profile stays visible through HTTP and typed history failures; history loads with the account', async () => {
  for (const failure of [() => { throw Object.assign(new Error('private history'), { status: 500 }); },
    () => ({ ...history, orders: [{ ...summary, createdAt: 1793000000.123 }] }),
    () => ({ ...history, orders: [{ ...summary, totalAmount: '250' }] })]) {
    const { api, controller, calls } = fixture(path => path.includes('/orders?page=') ? failure() : undefined);
    const page = fakePage(api);
    try {
      await page.controller.refresh();
      const input = page.nodes['account-private'].querySelectorAll('input')[0];
      input.value = 'Unsaved name';
      assert.ok(calls.some(call => call.path.includes('/orders')));
      const load = page.nodes['account-private'].querySelectorAll('button').find(button => button.textContent === 'Load your orders');
      assert.ok(load, 'retry stays available after a failed history load');
      await page.controller.page(0);
      assert.deepEqual(page.controller.state.profile, profile);
      assert.equal(page.controller.state.history, null);
      assert.match(page.controller.state.historyMessage, /Orders unavailable/);
      assert.equal(input.value, 'Unsaved name');
      assert.equal(page.nodes['account-private'].hidden, false);
      assert.doesNotMatch(page.nodes['account-private'].textContent, /private history/);
    } finally { page.destroy(); controller.clear(); }
  }
});

test('optional location failure cannot hide profile, but auth failures on any read clear private data', async () => {
  for (const value of [null, { latitude: '28.4', longitude: 77 }, { latitude: 91, longitude: 77 }]) {
    const { controller } = fixture(path => path === '/api/account/location' ? Promise.resolve(value) : undefined);
    await controller.refresh();
    assert.deepEqual(controller.state.profile, profile);
    assert.equal(controller.state.location, null);
    assert.match(controller.state.locationMessage, /unavailable/);
  }
  const unavailable = fixture(path => {
    if (path === '/api/account/location') throw Object.assign(new Error('private'), { status: 404 });
  });
  await unavailable.controller.refresh();
  assert.deepEqual(unavailable.controller.state.profile, profile, 'new frontend tolerates backend without location route');
  for (const path of ['/api/account/profile', '/api/account/location', '/api/account/orders?page=0']) {
    for (const status of [401, 403]) {
      const { controller } = fixture(route => {
        if (route === path) throw Object.assign(new Error('private'), { status });
      });
      await controller.refresh();
      if (path.includes('/orders')) await controller.page(0);
      assert.equal(controller.state.authenticated, false);
      assert.equal(controller.state.profile, null);
      assert.equal(controller.state.location, null);
    }
  }
});

test('profile read failure leaves history independently readable', async () => {
  const { controller } = fixture(path => {
    if (path === '/api/account/profile') throw Object.assign(new Error('private'), { status: 500 });
  });
  await controller.refresh();
  assert.equal(controller.state.profile, null);
  await controller.page(0);
  assert.deepEqual(controller.state.history, history);
});

test('saved pin is strictly numeric, bounded, optional and exposed only as a user-clicked safe link', async () => {
  assert.equal(validateLocation({ latitude: null, longitude: null }), null);
  for (const value of [null, {}, { latitude: null, longitude: 77 }, { latitude: '28', longitude: 77 },
    { latitude: NaN, longitude: 77 }, { latitude: 28, longitude: Infinity }, { latitude: 90.01, longitude: 77 },
    { latitude: 28, longitude: -180.01 }, { latitude: 28, longitude: 77, url: 'https://evil.test' }]) {
    assert.throws(() => validateLocation(value));
  }
  for (const pin of [{ latitude: 28.45, longitude: 77.02 }, { latitude: 0, longitude: 0 }, { latitude: -90, longitude: 180 }]) {
    assert.deepEqual(validateLocation(pin), pin);
    assert.ok(Object.isFrozen(validateLocation(pin)));
    const { api, calls } = fixture(path => path === '/api/account/location' ? pin : undefined);
    const page = fakePage(api);
    await page.controller.refresh();
    const link = page.nodes['account-private'].querySelectorAll('a').find(link => link.textContent.includes('Maps'));
    assert.equal(link.href, `https://www.google.com/maps?q=${pin.latitude},${pin.longitude}`);
    assert.equal(link.referrerPolicy, 'no-referrer');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.ok(calls.every(call => call.path.startsWith('/api/')));
    page.controller.clear();
    assert.equal(page.controller.state.location, null);
    assert.equal(link.textContent, '');
    assert.equal(link.attributes.href, undefined);
    page.destroy();
  }
});

test('concurrent visible/focus refreshes coalesce without aborting profile or resurrecting cleared data', async () => {
  const pending = deferred();
  const { api, calls } = fixture(path => path === '/api/account/profile' ? pending.promise : undefined);
  const page = fakePage(api);
  const loaded = page.controller.refresh();
  page.win.dispatchEvent(new Event('focus'));
  page.doc.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.filter(call => call.path === '/api/session').length, 1);
  assert.equal(calls.filter(call => call.path === '/api/account/profile').length, 1);
  assert.equal(calls.find(call => call.path === '/api/account/profile').signal.aborted, false);
  page.doc.hidden = true; page.doc.dispatchEvent(new Event('visibilitychange'));
  pending.resolve(profile); await loaded;
  assert.equal(page.controller.state.profile, null);
  assert.equal(page.nodes['account-private'].hidden, true);
  page.destroy();
});

test('late optional pin cannot restore coordinates after privacy clear even when abort is ignored', async () => {
  const pending = deferred();
  const { controller, calls } = fixture(path => path === '/api/account/location' ? pending.promise : undefined);
  const loading = controller.refresh();
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  assert.deepEqual(controller.state.profile, profile);
  controller.clear();
  assert.equal(calls.find(call => call.path === '/api/account/location').signal.aborted, true);
  pending.resolve({ latitude: 28.45, longitude: 77.02 }); await loading;
  assert.equal(controller.state.location, null);
  assert.equal(controller.state.profile, null);
});