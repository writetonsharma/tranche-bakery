import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { StorefrontApi } from '../api.mjs';
import { SubscribeController } from '../subscribe.mjs';
import { validatePlans, validateCurrent, subscriptionInput } from '../subscription-model.mjs';

const artifact = new URL('../../../TrancheWA-App/target/subscription-http-contract.json', import.meta.url);
test('real loopback backend JSON: public plans, pending web sign-up and its activation validate exactly',
  { skip: !existsSync(artifact) && 'Run Maven WebSubscriptionHttpTest first to generate synthetic HTTP evidence' }, async () => {
    const wire = JSON.parse(readFileSync(artifact, 'utf8'));
    const plans = validatePlans(wire.plans);
    assert.equal(plans.audience, 'PUBLIC');
    assert.ok(plans.plans.length >= 1);
    for (const plan of plans.plans) {
      // The page shows a breakdown only when it adds up; the real plans must.
      assert.equal(Math.round(plan.weeklyPrice * 100) * plan.paidWeeks +
        Math.round(plan.deliveryCharge * 100) * (plan.paidWeeks + plan.freeWeeks), Math.round(plan.upfront * 100), plan.code);
    }
    const pending = validateCurrent(wire.pending);
    assert.equal(pending.status, 'PENDING_PAYMENT');
    assert.equal(pending.channel, 'WEB');
    assert.ok(pending.paymentUrl);
    const active = validateCurrent(wire.active);
    assert.equal(active.status, 'ACTIVE');
    assert.equal(active.paymentUrl, null);
    assert.equal(active.amount, pending.amount);
    // A request built from the real plans in the page's way is accepted by the client model.
    const plan = plans.plans[0], option = plan.options[0];
    assert.equal(subscriptionInput({ planCode: plan.code, option: option.index, items: option.components.map(part => part.choices[0]),
      deliveryDay: plans.days[0].day, name: 'Wire Subscriber', address: 'House 7, Subscription Street, DLF Phase 5',
      deliveryPreference: 'DOOR', loafPreference: 'SLICED' }, plans).planCode, plan.code);

    let current = wire.pending;
    const api = new StorefrontApi(async path => {
      if (path === '/api/session') return Response.json({ authenticated: true, customer: { id: 7 }, csrfHeaderName: 'X-XSRF-TOKEN', csrfToken: 'wire' });
      if (path === '/api/subscriptions/plans') return Response.json(wire.plans);
      if (path === '/api/subscriptions/current') return Response.json(current);
      return Response.json({}, { status: 500 });
    }, { checkoutEnabled: true });
    const controller = new SubscribeController({ api });
    await controller.load();
    assert.equal(controller.state.current.status, 'PENDING_PAYMENT');
    current = wire.active;
    await controller.load();
    assert.equal(controller.state.current.status, 'ACTIVE');
    assert.match(controller.state.message, /Payment confirmed/);
  });
