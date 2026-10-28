import { LatestRequest } from './model.mjs';
import { cartInput, validateCart } from './checkout-model.mjs';
import { mergeBaskets, RETAIL_LIMIT, totalItems } from './shopping-model.mjs';

export const sameBasket = (a, b) => (a.date || '') === (b.date || '') &&
  JSON.stringify([...a.lines].sort((x, y) => x.itemId - y.itemId)) ===
  JSON.stringify([...b.lines].sort((x, y) => x.itemId - y.itemId));

export class BasketSync {
  constructor({ api, allowedIds, getBasket, onBasket, getShopping = () => null,
    onChange = () => {}, onAssociate = () => {}, onIdentityLost = () => {}, guestIntent,
    isActive = () => true, now = Date.now,
    delay = (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    cancel = timer => globalThis.clearTimeout(timer) }) {
    Object.assign(this, { api, allowedIds, getBasket, onBasket, getShopping, onChange, onAssociate, onIdentityLost, isActive, now, delay, cancel });
    this.guestIntent = guestIntent;
    this.latest = new LatestRequest(); this.identity = null; this.revision = 0;
    this.state = this.empty();
  }
  empty() { return { cart: null, associated: false, dirty: false, choice: false, busy: false, retry: false, migrationBlocked: false, message: '' }; }
  emit() { this.onChange(this.state); }
  setIdentity(id) {
    if (id === this.identity) return;
    this.pause();
    if (this.state.associated) this.onBasket({ lines: [], date: '' });
    this.identity = id; this.revision++; this.pending = null;
    this.state = this.empty(); this.emit();
  }
  pause() {
    this.cancel(this.timer); this.latest.invalidate();
    if (this.state.busy && this.writing) {
      this.state.retry = true;
      this.state.message = 'Save not confirmed. Retry saving; reloading may lose edits.';
    }
    this.state.busy = false; this.writing = false; this.emit();
  }
  hold() { this.held = true; this.cancel(this.timer); }
  release() { this.held = false; this.schedule(); }
  changed() {
    this.revision++; this.state.dirty = true;
    this.state.message = 'Saving…';
    this.emit(); this.schedule();
  }
  writable() {
    const lines = this.getBasket().lines;
    return !this.state.migrationBlocked && totalItems(lines) <= RETAIL_LIMIT && lines.every(line => this.allowedIds.has(line.itemId));
  }
  schedule() {
    this.cancel(this.timer);
    if (!this.held && this.identity && this.isActive() && this.state.associated && this.state.dirty && !this.state.retry) {
      if (!this.writable()) {
        this.state.message = this.state.migrationBlocked ? this.migrationMessage() : 'Merged basket unsaved; edits last only on this page. Reloading loses them. Original device additions remain stored. Reduce to five available items or contact the bakery for a bulk order.';
        this.emit(); return;
      }
      this.timer = this.delay(() => this.save(), 400);
    }
  }
  async operation(action, writing = false) {
    if (this.held || !this.identity || !this.isActive() || this.state.busy) return false;
    const identity = this.identity, ticket = this.latest.begin();
    const current = () => this.latest.current(ticket) && this.identity === identity && this.isActive();
    this.state.busy = true; this.writing = writing; this.emit();
    let deferred = false;
    try {
      const session = await this.api.session(ticket.signal);
      if (!current()) return false;
      if (!session.authenticated || session.customer?.id !== identity) {
        this.setIdentity(null); this.onIdentityLost(); return false;
      }
      if (this.held) { deferred = true; return false; }
      return await action(ticket.signal, current);
    } catch (error) {
      if (!current()) return false;
      if ([401, 403].includes(error.status)) { this.setIdentity(null); this.onIdentityLost(); return false; }
      this.state.retry = true;
      this.state.message = 'Basket save or load not confirmed. Edits kept on this page; reloading may lose them. Please retry.';
      return false;
    } finally {
      if (current()) {
        this.state.busy = false; this.writing = false; this.emit();
        if (deferred && !this.held) this.schedule();
      }
    }
  }
  async refresh() {
    // Exactly one successful initial GET per identity. Focus/drawer never reload.
    if (this.state.associated || this.state.busy || this.state.retry) return false;
    return this.operation(async (signal, current) => {
      const cart = validateCart(await this.api.request('/api/cart', undefined, signal));
      if (!current() || this.held) return false;
      const local = this.getBasket();
      this.state.migrationBlocked = this.guestIntent?.uncertain() === true || this.guestIntent?.retaining === true;
      if (this.guestIntent?.hasRetained?.()) this.guestIntent.retain?.();
      const merged = this.state.migrationBlocked ? { lines: cart.lines, date: cart.date || '' } : mergeBaskets(local, cart, this.getShopping());
      this.state.cart = cart; this.state.associated = true;
      this.state.dirty = !sameBasket(merged, cart);
      // E.g. logout removed page-owned lines, but an unsaved guest original
      // remains. A clean account GET is not permission to retire that intent.
      if (!this.state.dirty && this.guestIntent?.hasRetained?.()) this.state.migrationBlocked = true;
      this.associationAcknowledged = false;
      if (!this.state.dirty && !this.state.migrationBlocked) this.acknowledgeAssociation();
      if (!sameBasket(local, merged)) this.onBasket(merged);
      this.state.message = this.state.migrationBlocked ? this.migrationMessage() : this.state.dirty ? 'Baskets merged. Saving…' : '';
      this.emit(); this.schedule(); return true;
    });
  }
  async retry() {
    if (this.state.migrationBlocked) return false;
    this.state.retry = false;
    if (!this.state.associated) return this.refresh();
    return this.save();
  }
  async save() {
    this.cancel(this.timer);
    if (!this.state.associated || !this.state.dirty || this.state.retry || !this.state.cart || !this.writable() || this.state.busy) return false;
    const task = this.operation(async (signal, current) => {
      // Conflicts read only a version. Remote lines/date/quote NEVER reach onBasket.
      for (let attempt = 0; attempt < 2; attempt++) {
        const revision = this.revision, snapshot = structuredClone(this.getBasket());
        const input = cartInput(this.state.cart.version, snapshot, this.allowedIds, this.now());
        if (!this.associationAcknowledged && this.guestIntent?.beforeSave() === false) throw new Error('Guest receipt unavailable');
        let response;
        try { response = await this.api.request('/api/cart', input, signal, 'PUT'); }
        catch (error) {
          if (!current()) return false;
          if (error.status !== 409 || attempt !== 0) throw error;
          const remote = await this.api.request('/api/cart', undefined, signal);
          if (!current()) return false;
          if (!Number.isSafeInteger(remote?.version) || remote.version < 0 || remote.version >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid cart version');
          this.state.cart = { ...this.state.cart, version: remote.version };
          if (this.held || !this.writable()) return false;
          continue;
        }
        if (!current()) return false;
        const cart = validateCart(response);
        if (cart.version !== input.version + 1 || !sameBasket(cart, input)) throw new Error('Invalid basket acknowledgement');
        this.state.cart = cart;
        this.acknowledgeAssociation();
        this.state.dirty = revision !== this.revision;
        this.state.message = this.state.migrationBlocked ? this.migrationMessage() : this.state.dirty ? 'Saving…' : 'Saved';
        return true;
      }
      return false;
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
    this.cancel(this.timer);
    if (this.state.dirty && !this.state.retry) await this.save();
    return Boolean(this.identity && this.isActive() && this.state.associated && !this.state.migrationBlocked && !this.state.dirty && !this.state.retry && !this.state.busy && sameBasket(this.getBasket(), this.state.cart));
  }
  acknowledgeAssociation() {
    if (this.associationAcknowledged) return;
    if (this.guestIntent?.accepted() === false) {
      this.state.migrationBlocked = true;
      return;
    }
    this.associationAcknowledged = true; this.onAssociate();
  }
  migrationMessage() {
    return 'An earlier save may have succeeded. Stored additions were NOT added again. Check your basket before discarding them, or contact the bakery. Saving and checkout are paused.';
  }
  discardRetainedGuest() {
    if (!this.state.migrationBlocked || this.state.busy || !this.identity || !this.isActive()) return false;
    if (this.guestIntent?.accepted() === false) return false;
    this.state.migrationBlocked = false; this.acknowledgeAssociation();
    this.state.message = 'Stored additions discarded. Basket unchanged.';
    this.emit(); this.schedule(); return true;
  }
  conflict() {
    this.cancel(this.timer);
    this.state.dirty = true; this.state.retry = true;
    this.state.message = 'Saved basket changed. Your edits are kept on this page; reloading may lose them. Retry saving before reviewing.';
    this.emit();
  }
}