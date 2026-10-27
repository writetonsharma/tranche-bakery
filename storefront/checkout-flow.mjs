import { LatestRequest } from './model.mjs';
import { cartInput, validateCart, validatePrepared, fulfillment, validateCheckout, immutable, problemMessage } from './checkout-model.mjs';
import { validateOrderDetail, validateProfile } from './account-model.mjs';

const initial = () => ({ cart: null, prepared: null, review: null, attempt: null, result: null,
  busy: false, ambiguous: false, suspended: false, dirty: false, needsReload: false, message: '' });
const stateMessage = status => ({
  CREATING: 'Payment link is being created. Do not submit another order.',
  PAYABLE: 'Order awaiting payment. Open the secure payment link, then refresh verified status here.',
  UNKNOWN: 'Payment creation is uncertain. Contact bakery support before any new order or payment. Status checks do not create another link.',
  PAID: 'Payment received — verified by the bakery. This is your past order, not a new basket. Choose Start new order when ready; your basket will not be emptied automatically.',
  REVIEW_REQUIRED: 'Payment/order needs manual review. Contact bakery support; do not pay again.',
  CANCELLED: 'Checkout cancelled. No payment link is available. Contact support if money was debited.',
  EXPIRED: 'Checkout expired. Do not pay an old link. Contact support if money was debited.'
}[status]);

export class CheckoutFlow {
  constructor({ api, enabled, allowedIds, getBasket, onBasket, onChange = () => {},
    now = Date.now, uuid = () => globalThis.crypto.randomUUID(), onIdentityLost = () => {}, onActivity = () => {},
    accountEnabled = false, isActive = () => true, beforePrepare = async () => true, onDefaults = () => {} }) {
    Object.assign(this, { api, enabled: enabled === true, allowedIds, getBasket, onBasket, onChange, now, uuid, onIdentityLost, onActivity });
    Object.assign(this, { accountEnabled, isActive, beforePrepare, onDefaults });
    this.recoveryReady = !accountEnabled; this.defaultsRead = false; this.dismissedAttemptId = null;
    this.state = initial(); this.latest = new LatestRequest(); this.identity = null; this.polls = 0;
  }
  emit() { this.onChange(this.state); }
  setIdentity(id) {
    const next = this.enabled && Number.isSafeInteger(id) && id > 0 ? id : null;
    if (this.identity !== next) {
      this.latest.invalidate(); this.identity = next; this.state = initial(); this.polls = 0; this.emit();
      this.recoveryReady = !this.accountEnabled; this.defaultsRead = false; this.dismissedAttemptId = null;
    }
  }
  suspend(reason = 'paused') {
    this.latest.invalidate();
    if (this.accountEnabled && this.state.attempt?.id) {
      // A known owned ID is sufficient for GET recovery. Remove private delivery
      // fields and any no-longer-needed acceptance key while the page is hidden.
      this.state.attempt = immutable({ id: this.state.attempt.id, quote: this.state.attempt.quote,
        payload: null, recovered: true });
    }
    // Preserve ONLY an already accepted/possibly sent attempt for same-identity explicit recovery.
    Object.assign(this.state, { prepared: null, review: null, result: null, busy: false,
      suspended: true, ambiguous: this.state.ambiguous || Boolean(this.state.attempt && !this.state.attempt.id),
      message: `Checkout paused (${reason}). Recheck your login before recovering this attempt.` });
    this.emit();
  }
  changed() {
    this.suspend('basket changed');
    this.state.dirty = true; this.emit();
  }
  async run(action, { acceptance = false } = {}) {
    if (!this.enabled || !this.identity || this.state.busy || !this.isActive()) return;
    const identity = this.identity;
    const recovering = Boolean(this.state.attempt);
    const wasAmbiguous = this.state.ambiguous;
    let recoverRejected = false;
    const ticket = this.latest.begin();
    const current = () => this.latest.current(ticket) && this.identity === identity && this.isActive();
    this.state.busy = true; this.state.message = 'Checking securely with the bakery…'; this.onActivity(); this.emit();
    let sent = false;
    try {
      const session = await this.api.session(ticket.signal);
      if (!current()) return;
      if (!session.authenticated || session.customer?.id !== identity) { this.setIdentity(null); this.onIdentityLost(); return; }
      await action({ signal: ticket.signal, current, sending: () => { sent = true; } });
    } catch (error) {
      if (!current()) return;
      this.state.prepared = null; this.state.review = null; this.state.result = null;
      this.state.dirty = true;
      if ([401, 403].includes(error.status)) { this.setIdentity(null); this.onIdentityLost(); return; }
      if (error.code === 'CART_CONFLICT') this.state.needsReload = true;
      // Any non-contract response after POST may hide a committed order. NEVER create a new key.
      this.state.ambiguous = acceptance && (wasAmbiguous ||
        (sent || recovering) && (!error.code || error.status >= 500));
      if (acceptance && sent && !wasAmbiguous && !this.state.attempt?.id &&
          error.status === 409 && error.code === 'CHECKOUT_IN_PROGRESS') {
        // This fresh snapshot was definitively rejected, not an uncertain original
        // submission. Recover the other tab's owned order with GET, never POST.
        this.state.attempt = null;
        this.recoveryReady = !this.accountEnabled;
        recoverRejected = true;
      }
      this.state.message = this.state.ambiguous ?
        'The response was lost or uncertain. Do not create a new order. Explicitly retry this SAME attempt to recover its status, or contact support.' : problemMessage(error.code);
      if (acceptance && sent && !this.state.ambiguous && !['CHECKOUT_IN_PROGRESS', 'IDEMPOTENCY_CONFLICT'].includes(error.code)) this.state.attempt = null;
    } finally {
      if (current()) { this.state.busy = false; this.emit(); }
    }
    if (recoverRejected && current() && !this.state.attempt) return this.resume();
  }
  async load() {
    if (this.state.attempt) return;
    return this.run(async ({ signal, current }) => {
      const value = validateCart(await this.api.request('/api/cart', undefined, signal));
      if (!current()) return;
      const unavailable = value.lines.some(line => !this.allowedIds.has(line.itemId));
      Object.assign(this.state, { cart: value, prepared: null, review: null, result: null, needsReload: false, suspended: false, dirty: unavailable,
        message: unavailable ?
          'Account basket contains bakes unavailable in this catalogue and was not loaded. Your entire local basket is unchanged; nothing was removed or merged. Choose Save this basket to explicitly replace the account basket with your current local basket, or contact the bakery.' :
          'Account basket loaded by your choice. Edits are not saved until you choose Save.' });
      if (!unavailable) this.onBasket({ lines: value.lines.map(l => ({ ...l })), date: value.date || '' });
    });
  }
  async save() {
    if (this.state.attempt || this.state.needsReload) return;
    // Snapshot the user-selected local basket BEFORE requesting the account version.
    const basket = structuredClone(this.getBasket());
    return this.run(async ({ signal, current }) => {
      let cart = this.state.cart;
      if (!cart) cart = validateCart(await this.api.request('/api/cart', undefined, signal));
      if (!current()) return;
      const input = cartInput(cart.version, basket, this.allowedIds, this.now());
      const value = validateCart(await this.api.request('/api/cart', input, signal, 'PUT'));
      if (!current()) return;
      if (value.version !== input.version + 1 || JSON.stringify(value.lines) !== JSON.stringify(input.lines) || value.date !== input.date) throw new Error('Invalid saved basket');
      Object.assign(this.state, { cart: value, prepared: null, review: null, result: null, suspended: false, dirty: false,
        message: 'Your chosen basket replaced the account basket. Prepare a fresh quote to review checkout.' });
    });
  }
  async prepare() {
    if (!this.recoveryReady || !await this.beforePrepare()) return;
    if (!this.state.cart || this.state.dirty || this.state.needsReload || this.state.attempt) return;
    const cart = this.state.cart;
    this.state.prepared = null; this.state.review = null;
    return this.run(async ({ signal, current }) => {
      const value = validatePrepared(await this.api.request('/api/checkout/prepare', { cartVersion: cart.version }, signal), cart, this.now());
      if (!current()) return;
      if (this.state.cart?.version !== cart.version || this.state.dirty || this.state.needsReload) {
        this.state.message = 'Account basket changed while reviewing. Choose Review order again for its current quote.';
        return;
      }
      if (value.quote.creditApplied > 0 || value.quote.totalAmount <= 0) {
        this.state.message = problemMessage(value.quote.creditApplied > 0 ? 'CREDIT_SUPPORT_REQUIRED' : 'ZERO_PAYABLE_SUPPORT_REQUIRED'); return;
      }
      this.state.prepared = value; this.state.suspended = false;
      this.state.message = 'Review this exact server quote and your delivery details. Preparing has not placed an order or reserved capacity.';
    });
  }
  review(details) {
    if (!this.state.prepared || this.state.attempt || this.state.busy || this.state.suspended) return;
    try {
      if (Date.parse(this.state.prepared.expiresAt) <= this.now()) throw new Error('Expired');
      this.state.review = fulfillment(details);
      this.state.message = 'Review the fixed delivery details and quoted total below. Confirm & Pay creates a real order and requests a payment link.';
    } catch { this.state.message = 'Enter a name (1–100 characters), single-line address (10–2000 characters) and both preferences, or refresh an expired quote.'; }
    this.emit();
  }
  async confirm(details = this.state.review) {
    if (this.state.attempt || !this.state.prepared || this.state.busy || this.state.suspended || !details) return;
    let snapshot;
    try { snapshot = fulfillment(details); } catch { return; }
    const quote = this.state.prepared;
    if (Date.parse(quote.expiresAt) <= this.now()) { this.suspend('quote expired'); return; }
    let key;
    try { key = this.uuid(); } catch { this.state.message = 'Secure checkout is unavailable in this browser.'; this.emit(); return; }
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) return;
    this.state.attempt = immutable({ payload: { idempotencyKey: key, cartVersion: quote.cartVersion, quoteToken: quote.quoteToken, ...snapshot },
      quote: quote.quote, id: null });
    this.state.prepared = null; this.state.review = null;
    return this.send();
  }
  async send() {
    const attempt = this.state.attempt;
    return this.run(async ({ signal, current, sending }) => {
      sending();
      const result = validateCheckout(await this.api.request('/api/checkout', attempt.payload, signal), attempt.id, this.now());
      if (!current()) return;
      this.accept(result, attempt);
    }, { acceptance: true });
  }
  accept(result, attempt) {
    this.state.attempt = immutable({ ...attempt, id: result.id });
    Object.assign(this.state, { result, suspended: false, ambiguous: false, message: stateMessage(result.status) });
  }
  async retry() {
    if (!this.state.attempt || this.state.attempt.id || !this.state.ambiguous || this.state.busy) return;
    return this.send(); // Explicit only; the same frozen payload/key, even after token expiry.
  }
  async check() {
    const attempt = this.state.attempt;
    if (!attempt?.id) return;
    return this.run(async ({ signal, current }) => {
      if (attempt.recovered) {
        const detail = validateOrderDetail(await this.api.request(`/api/account/orders/${attempt.id}`, undefined, signal), attempt.id, this.now());
        if (current()) this.accept(detail, immutable({ ...attempt, payload: detail.fulfillment }));
        return;
      }
      const result = validateCheckout(await this.api.request(`/api/checkout/${attempt.id}`, undefined, signal), attempt.id, this.now());
      if (current()) this.accept(result, attempt);
    });
  }
  async poll() {
    if (this.state.suspended || this.state.busy || !['PAYABLE', 'CREATING', 'UNKNOWN'].includes(this.state.result?.status) || this.polls >= 10) return;
    this.polls++; return this.check();
  }
  async resume() {
    if (!this.accountEnabled || !this.identity || !this.isActive()) return;
    this.polls = 0;
    if (this.state.attempt?.id) {
      await this.check();
      if (this.state.result && !this.defaultsRead) {
        return this.run(async ({ signal, current }) => {
          await this.readDefaults(signal, current);
          if (current() && this.state.result) this.state.message = stateMessage(this.state.result.status);
        });
      }
      return;
    }
    // An ambiguous create keeps its exact original payload/key for explicit retry only.
    if (this.state.attempt) return;
    return this.run(async ({ signal, current }) => {
      const value = await this.api.request('/api/account/checkout', undefined, signal);
      if (!current()) return;
      if (!value || Object.keys(value).join(',') !== 'checkout') throw new Error('Invalid recovery');
      const detail = value.checkout === null ? null : validateOrderDetail(value.checkout, undefined, this.now());
      this.recoveryReady = true;
      if (detail && detail.id !== this.dismissedAttemptId) {
        const attempt = immutable({ id: detail.id, quote: detail.quote, payload: detail.fulfillment, recovered: true });
        this.accept(detail, attempt);
      } else {
        this.state.suspended = false;
        this.state.message = 'Account checked. Review your basket before placing a new order.';
      }
      await this.readDefaults(signal, current);
    });
  }
  async readDefaults(signal, current) {
    if (this.defaultsRead) return;
    try {
      const profile = validateProfile(await this.api.request('/api/account/profile', undefined, signal));
      if (!current()) return;
      this.defaultsRead = true; this.onDefaults(profile);
    } catch (error) {
      if (!current()) return;
      if ([401, 403].includes(error.status)) { this.setIdentity(null); this.onIdentityLost(); }
      // Optional suggestions must never erase a validated payment result or
      // imply that an accepted order failed. A later visible return may retry GET.
      else if (!this.state.result) this.state.message = 'Saved defaults are unavailable. Enter delivery details for this order; nothing was saved to your profile.';
    }
  }
  startNewOrder() {
    if (this.state.busy || !['PAID', 'CANCELLED', 'EXPIRED'].includes(this.state.result?.status)) return;
    this.latest.invalidate(); this.dismissedAttemptId = this.state.attempt.id;
    const cart = this.state.cart, dirty = this.state.dirty, needsReload = this.state.needsReload;
    this.state = { ...initial(), cart, dirty, needsReload,
      message: 'New order selected. Your existing basket is unchanged — remove any past-order bakes you do not want, then review a fresh quote.' };
    this.polls = 0; this.emit();
  }
}