import { LatestRequest } from './model.mjs';
import { cartInput, validateCart } from './checkout-model.mjs';

// Order-independent comparison; no prices, identity or fulfillment in this model.
export const sameBasket = (a, b) => (a.date || '') === (b.date || '') &&
  JSON.stringify([...a.lines].sort((x, y) => x.itemId - y.itemId)) ===
  JSON.stringify([...b.lines].sort((x, y) => x.itemId - y.itemId));

export class BasketSync {
  constructor({ api, allowedIds, getBasket, onBasket, onChange = () => {}, onAssociate = () => {},
    onIdentityLost = () => {}, isActive = () => true, now = Date.now,
    delay = (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    cancel = timer => globalThis.clearTimeout(timer) }) {
    Object.assign(this, { api, allowedIds, getBasket, onBasket, onChange, onAssociate, onIdentityLost, isActive, now, delay, cancel });
    this.latest = new LatestRequest(); this.identity = null; this.revision = 0;
    this.state = this.empty();
  }
  empty() { return { cart: null, associated: false, dirty: false, choice: false, busy: false, message: '' }; }
  emit() { this.onChange(this.state); }
  setIdentity(id) {
    if (id === this.identity) return;
    this.pause();
    // Never carry an account basket into anonymous storage or a different account.
    if (this.state.associated) this.onBasket({ lines: [], date: '' });
    this.identity = id; this.revision++;
    this.state = this.empty(); this.emit();
  }
  pause() {
    this.cancel(this.timer); this.latest.invalidate();
    if (this.state.busy && this.writing) {
      this.state.choice = true;
      this.state.message = 'Basket save was interrupted. Keep your edits and choose which basket to use after reconnecting.';
    }
    this.state.busy = false; this.writing = false; this.emit();
  }
  hold() { this.held = true; this.cancel(this.timer); }
  release() { this.held = false; this.schedule(); }
  changed() {
    this.revision++; this.state.dirty = true;
    this.state.message = this.state.choice ? 'Choose which basket to use. Your edits are kept here.' : 'Basket changes waiting to save…';
    this.emit(); this.schedule();
  }
  schedule() {
    this.cancel(this.timer);
    if (!this.held && this.identity && this.isActive() && this.state.associated && this.state.dirty && !this.state.choice) {
      this.timer = this.delay(() => this.save(), 400);
    }
  }
  async operation(action, writing = false) {
    if (this.held || !this.identity || !this.isActive() || this.state.busy) return false;
    const id = this.identity, ticket = this.latest.begin();
    const current = () => this.latest.current(ticket) && this.identity === id && this.isActive();
    this.state.busy = true; this.writing = writing; this.emit();
    let deferred = false;
    try {
      const session = await this.api.session(ticket.signal);
      if (!current()) return false;
      if (!session.authenticated || session.customer?.id !== id) {
        this.setIdentity(null); this.onIdentityLost(); return false;
      }
      // A transition may start while session bootstrap is in flight. Finish
      // safely, but defer the next request instead of issuing it mid-slide.
      if (this.held) { deferred = true; return false; }
      return await action(ticket.signal, current);
    } catch (error) {
      if (!current()) return false;
      if ([401, 403].includes(error.status)) { this.setIdentity(null); this.onIdentityLost(); return false; }
      // Lost acknowledgements are conflicts too: never assume an old version still applies.
      this.state.choice = true;
      this.state.message = error.status === 409 ?
        'Account basket changed elsewhere. Your edits are kept. Choose account basket or replace it with this device basket.' :
        'Basket could not be confirmed. Your edits are kept; choose a basket to reconcile safely.';
      return false;
    } finally {
      if (current()) {
        this.state.busy = false; this.writing = false; this.emit();
        if (deferred && !this.held) this.schedule();
      }
    }
  }
  associate(cart, replace) {
    this.state.cart = cart; this.state.associated = true; this.state.choice = false; this.state.dirty = false;
    this.onAssociate();
    if (replace) this.onBasket({ lines: cart.lines.map(line => ({ ...line })), date: cart.date || '' });
    this.state.message = 'Account basket up to date. Changes save automatically.';
  }
  async refresh() {
    if ((this.state.dirty && this.state.associated) || this.state.choice || this.state.busy) return false;
    const revision = this.revision;
    const wasDirty = this.state.dirty;
    return this.operation(async (signal, current) => {
      const cart = validateCart(await this.api.request('/api/cart', undefined, signal));
      if (!current() || this.held) return false;
      if (revision !== this.revision) {
        this.state.choice = true;
        this.state.cart = cart; this.state.message = 'Basket edited while account was loading. Choose which basket to use.';
        return false;
      }
      const local = this.getBasket();
      const unsupported = cart.lines.some(line => !this.allowedIds.has(line.itemId));
      if (unsupported || (!this.state.associated && (local.lines.length || local.date || wasDirty) && !sameBasket(local, cart))) {
        this.state.cart = cart; this.state.choice = true;
        this.state.message = unsupported ? 'Account basket includes unavailable bakes. Keep this device basket to explicitly replace it, or contact the bakery.' :
          'This device and your account have different baskets. Choose one before anything is saved. Nothing is merged.';
        return false;
      }
      this.associate(cart, !sameBasket(local, cart)); return true;
    });
  }
  async choose(which) {
    if (!['account', 'device'].includes(which) || !this.state.choice) return false;
    const revision = this.revision;
    const ok = await this.operation(async (signal, current) => {
      const cart = validateCart(await this.api.request('/api/cart', undefined, signal));
      if (!current() || this.held || revision !== this.revision) return false;
      if (which === 'account') {
        if (cart.lines.some(line => !this.allowedIds.has(line.itemId))) {
          this.state.message = 'Unavailable account bakes cannot be loaded. Keep this device basket to replace them, or contact support.'; return false;
        }
        this.associate(cart, true);
      } else {
        this.state.cart = cart; this.state.associated = true; this.state.choice = false; this.state.dirty = true;
        this.onAssociate();
      }
      return true;
    });
    if (ok && which === 'device') return this.save();
    return ok;
  }
  async save() {
    this.cancel(this.timer);
    if (!this.state.associated || !this.state.dirty || this.state.choice || !this.state.cart) return false;
    if (this.state.busy) return false;
    const revision = this.revision, snapshot = structuredClone(this.getBasket());
    const task = this.operation(async (signal, current) => {
      const input = cartInput(this.state.cart.version, snapshot, this.allowedIds, this.now());
      const cart = validateCart(await this.api.request('/api/cart', input, signal, 'PUT'));
      if (!current()) return false;
      if (cart.version !== input.version + 1 || !sameBasket(cart, input)) throw new Error('Invalid basket acknowledgement');
      this.state.cart = cart;
      this.state.dirty = revision !== this.revision;
      this.state.message = this.state.dirty ? 'Saving your newer basket edits…' : 'Account basket saved automatically.';
      return true;
    }, true);
    this.pending = task;
    const ok = await task;
    if (this.pending === task) this.pending = null;
    if (ok && this.state.dirty) this.schedule();
    return ok;
  }
  async flush() {
    this.cancel(this.timer);
    if (this.pending) await this.pending;
    if (this.state.dirty && !this.state.choice) await this.save();
    return Boolean(this.identity && this.isActive() && this.state.associated && !this.state.dirty && !this.state.choice && !this.state.busy);
  }
}