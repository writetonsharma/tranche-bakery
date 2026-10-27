import test from 'node:test';
import assert from 'node:assert/strict';
import { GuestIntent, GUEST_RECEIPT_KEY } from '../guest-intent.mjs';
import { STORAGE_KEY, LatestRequest } from '../model.mjs';

const fixture = () => {
  const values = new Map([[STORAGE_KEY, JSON.stringify([{ itemId: 1, quantity: 3 }])]]);
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  return { values, storage, intent: new GuestIntent(storage) };
};
test('guest receipt persists only a constant fence; original anonymous intent survives until acknowledgement', () => {
  const f = fixture(), original = f.values.get(STORAGE_KEY);
  assert.equal(f.intent.uncertain(), false);
  assert.equal(f.intent.beforeSave(), true);
  assert.equal(f.values.get(STORAGE_KEY), original);
  assert.equal(f.values.get(GUEST_RECEIPT_KEY), 'pending');
  assert.equal(new GuestIntent(f.storage).uncertain(), true);
  assert.equal(f.intent.accepted(), true);
  assert.equal(f.values.size, 0);
});
test('blocked receipt writes fail closed before sending; failed retirement retains replay fence', () => {
  const f = fixture();
  f.storage.setItem = () => { throw new Error('blocked'); };
  assert.equal(f.intent.beforeSave(), false);
  assert.equal(f.values.has(STORAGE_KEY), true);
  f.values.set(GUEST_RECEIPT_KEY, 'pending');
  f.storage.removeItem = () => { throw new Error('blocked'); };
  assert.equal(f.intent.accepted(), false);
  assert.equal(f.intent.uncertain(), true);
  f.storage.getItem = () => { throw new Error('blocked'); };
  assert.equal(f.intent.uncertain(), true);
});
test('crash between intent and receipt removal leaves no additions to replay and still requires explicit resolution', () => {
  const f = fixture(); f.intent.beforeSave();
  f.storage.removeItem = key => { if (key === GUEST_RECEIPT_KEY) throw new Error('crash'); f.values.delete(key); };
  assert.equal(f.intent.accepted(), false);
  assert.equal(f.values.has(STORAGE_KEY), false);
  assert.equal(new GuestIntent(f.storage).uncertain(), true);
});

test('session-check generation invalidation rejects pre-auth responses even if abort is ignored; fresh check proceeds independently', async () => {
  const checks = new LatestRequest();
  const old = checks.begin();
  let release;
  const delayedAnonymous = new Promise(resolve => { release = resolve; });
  let authenticated = true;
  const applying = delayedAnonymous.then(view => { if (checks.current(old)) authenticated = view.authenticated; });
  checks.invalidate(); // Explicit OTP authentication starts.
  assert.equal(old.signal.aborted, true);
  const fresh = checks.begin();
  assert.equal(checks.current(fresh), true);
  release({ authenticated: false }); await applying;
  assert.equal(authenticated, true);
  assert.equal(checks.current(old), false);
});

test('a different page cannot claim an existing uncertainty fence or persist any account metadata', () => {
  const f = fixture();
  assert.equal(f.intent.beforeSave(), true);
  assert.equal(new GuestIntent(f.storage).beforeSave(), false);
  assert.deepEqual([...f.values.keys()].sort(), [STORAGE_KEY, GUEST_RECEIPT_KEY].sort());
  assert.equal(f.values.get(GUEST_RECEIPT_KEY), 'pending');
});