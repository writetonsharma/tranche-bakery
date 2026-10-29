import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StorefrontApi } from '../api.mjs';
import { validatePlans, validateCurrent, subscriptionInput } from '../subscription-model.mjs';
import { SubscribeController, attachSubscribe } from '../subscribe.mjs';

const html = await readFile(new URL('../../subscribe.html', import.meta.url), 'utf8');
const loaves = ['Classic Table White', 'Multi-Seed Loaf'];
const rolls = ['Multi-Seed Rolls', 'Sesame Burger Buns'];
const plansFor = (audience = 'PUBLIC') => ({ audience, days: [
  { day: 'MONDAY', firstDelivery: '2026-11-02' }, { day: 'FRIDAY', firstDelivery: '2026-10-30' }],
plans: [{ code: audience === 'FF' ? 'FF_NORMAL' : 'PUB_NORMAL', name: audience === 'FF' ? 'Friends Bakes' : 'Weekly Bakes',
  tier: 'NORMAL', weeklyPrice: 240, deliveryCharge: 50, paidWeeks: 4, freeWeeks: 1, upfront: 1210, options: [
    { index: 0, label: 'Half loaf + 4 rolls', description: null, components: [
      { type: 'LOAF', portion: 'HALF', quantity: 1, choices: loaves }, { type: 'ROLL', portion: 'FULL', quantity: 4, choices: rolls }] },
    { index: 2, label: 'Two half loaves', description: 'Mix & match any two loaves', components: [
      { type: 'LOAF', portion: 'HALF', quantity: 1, choices: loaves }, { type: 'LOAF', portion: 'HALF', quantity: 1, choices: loaves }] }] }] });
const fulfillment = { name: 'Web Subscriber', address: 'House 7, Subscription Street, DLF Phase 5', deliveryPreference: 'DOOR', loafPreference: 'SLICED' };
const week = (status, start = '2026-10-30') => Array.from({ length: 5 }, (_, i) => ({ week: i + 1,
  date: new Date(Date.parse(start) + i * 7 * 86400000).toISOString().slice(0, 10), status: i === 0 ? status : 'SCHEDULED' }));
const subscription = (status = 'PENDING_PAYMENT') => ({ status, channel: 'WEB', planName: 'Weekly Bakes', tier: 'NORMAL',
  weeklyPrice: 240.0, deliveryCharge: 50.0, paidWeeks: 4, freeWeeks: 1, creditApplied: 0.0, amount: 1210.0, deliveryDay: 'FRIDAY',
  startDate: status === 'ACTIVE' ? '2026-10-30' : null, endDate: status === 'ACTIVE' ? '2026-11-27' : null,
  items: [{ name: 'Classic Table White', quantity: 1, portion: 'HALF' }, { name: 'Multi-Seed Rolls', quantity: 4, portion: 'FULL' }],
  deliveries: week(status === 'ACTIVE' ? 'CONFIRMED' : 'SCHEDULED'), fulfillment: structuredClone(fulfillment),
  paymentUrl: status === 'ACTIVE' ? null : 'https://rzp.io/i/websub', savings: 623 });
const profile = { version: 3, name: 'Saved Name', address: 'Flat 9, Saved Address Road, Gurugram', deliveryPreference: 'GATE', loafPreference: 'WHOLE' };
const choice = { planCode: 'PUB_NORMAL', option: 0, items: ['Multi-Seed Loaf', 'Sesame Burger Buns'], deliveryDay: 'FRIDAY', ...fulfillment };
const settle = async () => { for (let i = 0; i < 16; i++) await new Promise(resolve => setImmediate(resolve)); };
const problem = (status, code) => Response.json({ problems: [{ code, message: 'server text never shown' }] }, { status });

function fixture({ signedIn = false, current = null, hook = () => undefined } = {}) {
  const calls = [];
  const world = { signedIn, current, customer: 7 };
  const session = () => ({ authenticated: world.signedIn, customer: world.signedIn ? { id: world.customer } : null,
    csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: 'fixture-csrf' });
  const fetcher = async (path, options) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    calls.push({ path, method: options.method, body, headers: options.headers });
    const intercepted = await hook(path, body, world);
    if (intercepted) return intercepted;
    if (path === '/api/session') return Response.json(session());
    if (path === '/api/subscriptions/plans') return Response.json(plansFor(world.signedIn && world.customer === 8 ? 'FF' : 'PUBLIC'));
    if (!world.signedIn) return Response.json({}, { status: 401 });
    if (path === '/api/subscriptions/current') return Response.json({ subscription: world.current });
    if (path === '/api/account/profile') return Response.json(profile);
    if (path === '/api/subscriptions') { world.current = subscription(); return Response.json({ subscription: world.current }); }
    if (path === '/api/subscriptions/current/cancel') { world.current = null; return Response.json({ subscription: null }); }
    if (path === '/api/auth/challenge') return Response.json({ challengeId: 'fixture-challenge', expiresInSeconds: 300 });
    throw new Error(`Unexpected route ${path}`);
  };
  return { calls, world, api: new StorefrontApi(fetcher, { checkoutEnabled: true }) };
}

function page(options) {
  const setup = fixture(options);
  const virtualConsole = new VirtualConsole(); const errors = [];
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/subscribe.html', virtualConsole });
  const { window } = dom, { document } = window;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get() { throw new Error('No private persistence'); } });
  const view = attachSubscribe({ root: document.getElementById('subscribe-app'), api: setup.api, win: window, doc: document });
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const pick = (name, value) => {
    const input = $$(`#subscribe-app input[name="${name}"]`).find(row => row.value === String(value));
    input.checked = true; input.dispatchEvent(new window.Event('change'));
  };
  const select = (name, value) => { const node = $(`#subscribe-app select[name="${name}"]`); node.value = value; node.dispatchEvent(new window.Event('change')); };
  const submit = () => $$('#subscribe-app button').find(button => button.textContent.startsWith('Reserve and pay'));
  return { ...setup, ...view, window, document, $, $$, pick, select, submit, errors };
}

test('plan, current and sign-up schemas are exact and choices come only from offered plans', () => {
  const plans = validatePlans(plansFor());
  assert.ok(Object.isFrozen(plans) && Object.isFrozen(plans.plans[0].options[0].components[0].choices));
  assert.equal(plans.plans[0].options[1].index, 2, 'server option indexes are kept, not renumbered');
  for (const bad of [{ ...plansFor(), extra: 1 }, { ...plansFor(), audience: 'STAFF' },
    { ...plansFor(), days: [{ day: 'WEDNESDAY', firstDelivery: '2026-11-04' }] },
    { ...plansFor(), days: [{ day: 'MONDAY', firstDelivery: '2026-11-02' }, { day: 'MONDAY', firstDelivery: '2026-11-09' }] }]) {
    assert.throws(() => validatePlans(bad));
  }
  const duplicate = plansFor(); duplicate.plans.push(structuredClone(duplicate.plans[0]));
  assert.throws(() => validatePlans(duplicate));
  const nasty = plansFor(); nasty.plans[0].options[0].components[0].choices = ['Loaf\u2028'];
  assert.throws(() => validatePlans(nasty));

  assert.equal(validateCurrent({ subscription: null }), null);
  assert.equal(validateCurrent({ subscription: subscription() }).paymentUrl, 'https://rzp.io/i/websub');
  assert.equal(validateCurrent({ subscription: subscription('ACTIVE') }).deliveries[0].status, 'CONFIRMED');
  for (const bad of [{ ...subscription(), startDate: '2026-10-30' }, { ...subscription('ACTIVE'), paymentUrl: 'https://rzp.io/i/x' },
    { ...subscription(), paymentUrl: 'javascript:alert(1)' }, { ...subscription(), paymentUrl: 'http://rzp.io/i/x' },
    { ...subscription(), status: 'CANCELLED' }, { ...subscription(), phone: '919876543210' },
    { ...subscription(), deliveries: [{ week: 2, date: '2026-10-30', status: 'SCHEDULED' }] }]) {
    assert.throws(() => validateCurrent({ subscription: bad }));
  }

  assert.deepEqual(subscriptionInput({ ...choice, name: '  Web Subscriber ' }, plans), choice);
  for (const bad of [{ ...choice, items: ['Olive Loaf', 'Sesame Burger Buns'] }, { ...choice, items: ['Multi-Seed Loaf'] },
    { ...choice, option: 1 }, { ...choice, planCode: 'FF_NORMAL' }, { ...choice, deliveryDay: 'WEDNESDAY' },
    { ...choice, address: 'short' }, { ...choice, name: 'Line\nbreak' }, { ...choice, phone: '1' }]) {
    assert.throws(() => subscriptionInput(bad, plans));
  }
});

test('subscription routes exist only with checkout enabled, with exact bodies and parsed problem codes', async () => {
  const calls = [];
  const fetcher = async (path, options) => { calls.push({ path, options }); return problem(409, 'SUBSCRIPTION_EXISTS'); };
  const off = new StorefrontApi(fetcher);
  await assert.rejects(off.request('/api/subscriptions/plans'), /Disallowed API route/);
  const api = new StorefrontApi(fetcher, { checkoutEnabled: true });
  api.useSession({ authenticated: true, customer: { id: 7 }, csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: 't' });
  await assert.rejects(api.request('/api/subscriptions'), /Disallowed API body/);
  await assert.rejects(api.request('/api/subscriptions', { ...choice, extra: 1 }), /Disallowed API body/);
  await assert.rejects(api.request('/api/subscriptions/current/cancel', {}), /Disallowed API body/);
  await assert.rejects(api.request('/api/subscriptions/plans', undefined, undefined, 'POST'), /Disallowed API method/);
  await assert.rejects(api.request('/api/subscriptions/current/../cancel'), /Disallowed API route/);
  assert.equal(calls.length, 0);
  await assert.rejects(api.request('/api/subscriptions', choice), error => error.status === 409 && error.code === 'SUBSCRIPTION_EXISTS');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-XSRF-TOKEN'], 't');
});

test('a visitor sees public plans and signs in on the page; nothing private is requested first', async () => {
  const view = page();
  await settle();
  assert.equal(view.$('#subscribe-app').hidden, false);
  assert.equal(view.calls.some(call => call.path === '/api/subscriptions/current'), false);
  assert.equal(view.$$('#subscribe-app input[name="plan"]').length, 1);
  assert.equal(view.$$('#subscribe-app input[name="option"]').length, 2);
  assert.equal(view.$$('#subscribe-app input[name="day"]').length, 2);
  assert.match(view.$('#subscribe-app').textContent, /First delivery Fri, 30 Oct/);
  assert.equal(view.$('.subscribe-login').hidden, false);
  assert.equal(view.$('#subscribe-app input[name="name"]').closest('div').hidden, true);
  assert.equal(view.submit().disabled, true);
  assert.match(view.submit().textContent, /₹1,210/);
  assert.match(view.$('.subscribe-summary').textContent, /4 weeks × ₹240/);
  view.destroy();
});

test('a signed-in customer builds a subscription, reserves it, sees the payment link, and can cancel', async () => {
  const view = page({ signedIn: true });
  await settle();
  assert.equal(view.$('#subscribe-app input[name="name"]').value, profile.name, 'saved details are suggested');
  assert.equal(view.$('.subscribe-login').hidden, true);
  view.select('item-0', 'Multi-Seed Loaf'); view.select('item-1', 'Sesame Burger Buns'); view.pick('day', 'FRIDAY');
  for (const [key, value] of Object.entries(fulfillment)) view.$(`#subscribe-app [name="${key}"]`).value = value;
  view.submit().click(); await settle();
  const post = view.calls.find(call => call.path === '/api/subscriptions');
  assert.deepEqual(post.body, choice);
  assert.equal(post.method, 'POST');
  assert.match(view.$('#subscribe-status').textContent, /Pay below/);
  assert.equal(view.$('.subscribe-builder').hidden, true);
  const pay = view.$$('.subscribe-current a').find(link => link.textContent.startsWith('Pay ₹1,210'));
  assert.equal(pay.href, 'https://rzp.io/i/websub');
  assert.equal(pay.target, '_blank');
  assert.equal(pay.rel, 'noopener noreferrer');
  view.$$('.subscribe-current button').find(button => button.textContent === 'Cancel this request').click(); await settle();
  assert.equal(view.calls.filter(call => call.path === '/api/subscriptions/current/cancel').length, 1);
  assert.equal(view.calls.find(call => call.path === '/api/subscriptions/current/cancel').body, undefined);
  assert.match(view.$('#subscribe-status').textContent, /cancelled/i);
  assert.equal(view.$('.subscribe-current').hidden, true);
  assert.equal(view.$('.subscribe-builder').hidden, false);
  view.destroy();
});

test('changing the option rebuilds the bake choices and the summary', async () => {
  const view = page({ signedIn: true });
  await settle();
  view.pick('option', 2);
  const selects = view.$$('#subscribe-app select[name^="item-"]');
  assert.equal(selects.length, 2);
  assert.deepEqual([...selects[1].options].map(option => option.value), ['', ...loaves]);
  view.select('item-0', loaves[0]); view.select('item-1', loaves[1]);
  assert.match(view.$('.subscribe-summary').textContent, /Two half loaves · Classic Table White, Multi-Seed Loaf/);
  view.submit().click(); await settle();
  assert.equal(view.calls.some(call => call.path === '/api/subscriptions'), false, 'incomplete choices are never posted');
  assert.match(view.$('#subscribe-status').textContent, /Choose a plan/);
  view.destroy();
});

test('an active subscription shows deliveries and support routes, never the builder or a payment link', async () => {
  const view = page({ signedIn: true, current: subscription('ACTIVE') });
  await settle();
  assert.equal(view.$('.subscribe-builder').hidden, true);
  const card = view.$('.subscribe-current');
  assert.match(card.textContent, /Active · every Friday/);
  assert.equal(card.querySelectorAll('.subscribe-deliveries li').length, 5);
  assert.match(card.textContent, /Confirmed/);
  assert.match(card.textContent, /House 7, Subscription Street/);
  assert.equal(card.querySelectorAll('button').length, 0);
  assert.equal([...card.querySelectorAll('a')].some(link => link.href.includes('rzp.io')), false);
  assert.equal(view.calls.some(call => call.path === '/api/account/profile'), false);
  view.destroy();
});

test('returning from payment rechecks and reports activation; a duplicate sign-up shows the existing request', async () => {
  const view = page({ signedIn: true, hook: (path, body, world) => {
    if (path === '/api/subscriptions') { world.current = subscription(); return problem(409, 'SUBSCRIPTION_EXISTS'); }
  } });
  await settle();
  view.select('item-0', loaves[0]); view.select('item-1', rolls[0]); view.pick('day', 'MONDAY');
  view.submit().click(); await settle();
  assert.match(view.$('#subscribe-status').textContent, /already have a subscription/);
  assert.equal(view.$('.subscribe-current').hidden, false, 'the existing request is shown after a conflict');
  view.world.current = subscription('ACTIVE');
  view.window.dispatchEvent(new view.window.Event('focus')); await settle();
  assert.match(view.$('#subscribe-status').textContent, /Payment confirmed/);
  assert.match(view.$('.subscribe-current').textContent, /Active/);
  assert.equal(view.calls.filter(call => call.path === '/api/subscriptions').length, 1, 'writes are never retried');
  view.destroy();
});

test('an uncertain cancel is not retried and keeps the request visible with guidance', async () => {
  const view = page({ signedIn: true, current: subscription(), hook: path => path === '/api/subscriptions/current/cancel' ?
    problem(409, 'CANCEL_UNCONFIRMED') : undefined });
  await settle();
  view.$$('.subscribe-current button').find(button => button.textContent === 'Cancel this request').click(); await settle();
  assert.match(view.$('#subscribe-status').textContent, /Message the bakery before paying or cancelling again/);
  assert.equal(view.$('.subscribe-current').hidden, false);
  assert.equal(view.calls.filter(call => call.path === '/api/subscriptions/current/cancel').length, 1);
  view.destroy();
});

test('a different customer never sees the previous one\u2019s details; leaving the page wipes them', async () => {
  const view = page({ signedIn: true });
  await settle();
  const name = view.$('#subscribe-app input[name="name"]');
  assert.equal(name.value, profile.name);
  view.world.customer = 8;
  view.window.dispatchEvent(new view.window.Event('focus')); await settle();
  assert.match(view.$('#subscribe-app').textContent, /Friends & family plans/);
  assert.equal(name.value, profile.name, 'the new customer\u2019s own saved details are suggested afresh');
  name.value = 'Typed by customer 8';
  view.window.dispatchEvent(new view.window.Event('pagehide'));
  assert.equal(name.value, '');
  assert.equal(view.$('#subscribe-app').hidden, true);
  view.destroy();
});

test('a returning-visitor refresh never locks the form; a reservation started meanwhile wins', async () => {
  let hold = null;
  const view = page({ signedIn: true, hook: path => {
    if (path === '/api/subscriptions/current' && hold) return hold.then(() => Response.json({ subscription: null }));
  } });
  await settle();
  let release; hold = new Promise(resolve => { release = resolve; });
  view.window.dispatchEvent(new view.window.Event('focus')); await settle();
  view.window.dispatchEvent(new view.window.Event('focus')); await settle();
  assert.equal(view.calls.filter(call => call.path === '/api/subscriptions/current').length, 2, 'one refresh at a time');
  assert.equal(view.$('#subscribe-app input[name="day"]').disabled, false);
  hold = null;
  view.select('item-0', loaves[0]); view.select('item-1', rolls[0]); view.pick('day', 'FRIDAY');
  view.submit().click(); await settle();
  release(); await settle();
  assert.equal(view.calls.filter(call => call.path === '/api/subscriptions').length, 1);
  assert.equal(view.$('.subscribe-current').hidden, false, 'the superseded refresh cannot hide the new request');
  assert.match(view.$('#subscribe-status').textContent, /Pay below/);
  view.destroy();
});

test('controller ignores sign-up when anonymous and survives a plans outage without private data', async () => {
  const { api, calls } = fixture({ hook: path => path === '/api/subscriptions/plans' ? Response.json({}, { status: 503 }) : undefined });
  const controller = new SubscribeController({ api });
  await controller.load();
  assert.match(controller.state.message, /unavailable/);
  assert.equal(controller.state.plans, null);
  await controller.submit(choice);
  assert.equal(calls.some(call => call.path === '/api/subscriptions'), false);
});
