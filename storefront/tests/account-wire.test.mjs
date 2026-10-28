import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { StorefrontApi } from '../api.mjs';
import { AccountController } from '../account.mjs';
import { validateProfile, validateHistory, validateOrderDetail, validateLocation } from '../account-model.mjs';

const artifact = new URL('../../../TrancheWA-App/target/account-http-contract.json', import.meta.url);
test('real loopback backend JSON: actual checkout, verified paid history, timestamps and independent profile',
  { skip: !existsSync(artifact) && 'Run Maven WebAccountHttpTest first to generate synthetic HTTP evidence' }, async () => {
    const wire = JSON.parse(readFileSync(artifact, 'utf8'));
    assert.equal(validateProfile(wire.profile).name, 'Wire Customer');
    assert.equal(validateLocation(wire.location), null);
    assert.equal(validateHistory(wire.history, 0).orders[0].status, 'PAID');
    assert.equal(validateOrderDetail(wire.paid, wire.paid.id).status, 'PAID');
    assert.equal(validateOrderDetail(wire.payable, wire.payable.id, Date.parse(wire.payable.createdAt)).status, 'PAYABLE');
    for (const detail of [wire.paid, wire.payable]) {
      assert.equal(typeof detail.createdAt, 'string');
      assert.equal(typeof detail.expiresAt, 'string');
      assert.ok(Number.isFinite(Date.parse(detail.createdAt)));
    }
    const calls = [];
    const api = new StorefrontApi(async path => {
      calls.push(path);
      if (path === '/api/session') return Response.json(wire.session);
      if (path === '/api/account/profile') return Response.json(wire.profile);
      if (path === '/api/account/location') return Response.json({ latitude: null, longitude: null });
      return Response.json({}, { status: wire.historyFailureStatus });
    }, { checkoutEnabled: true });
    const controller = new AccountController({ api });
    await controller.refresh();
    assert.deepEqual(controller.state.profile, wire.profile, 'broken real history must not hide a valid real profile');
    assert.ok(calls.some(path => path.includes('/orders')), 'history loads with the account');
    await controller.page(0);
    assert.deepEqual(controller.state.profile, wire.profile);
    assert.match(controller.state.historyMessage, /unavailable/i);
  });