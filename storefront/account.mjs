import { StorefrontApi } from './api.mjs';
import { LatestRequest } from './model.mjs';
import { checkoutEnabled, OPAQUE_ID } from './checkout-model.mjs';
import { validateProfile, profileInput, validateHistory, validateOrderDetail } from './account-model.mjs';

const empty = () => ({ authenticated: false, profile: null, history: null, detail: null,
  busy: false, conflict: false, message: 'Sign in through the Products basket to see your account.' });

// Private data and identity live only in this instance; never in URLs or storage.
export class AccountController {
  #api; #latest = new LatestRequest(); #identity = null; #change; #active; #now;
  #state = Object.freeze(empty());
  constructor({ api, onChange = () => {}, isActive = () => true, now = () => Date.now() }) {
    this.#api = api; this.#change = onChange; this.#active = isActive; this.#now = now;
  }
  get state() { return this.#state; }
  #set(patch) { this.#state = Object.freeze({ ...this.#state, ...patch }); this.#change(this.#state); }
  clear(message = 'Account paused. Recheck your session to continue.') {
    this.#latest.invalidate(); this.#identity = null; this.#api.clearSession();
    this.#state = Object.freeze({ ...empty(), message }); this.#change(this.#state);
  }
  async #run(action, { bootstrap = false, saving = false } = {}) {
    if (!this.#active() || this.#state.busy) return;
    const ticket = this.#latest.begin();
    const current = () => this.#latest.current(ticket) && this.#active();
    this.#set({ busy: true, message: 'Checking securely with the bakery…' });
    try {
      const raw = await this.#api.request('/api/session', undefined, ticket.signal);
      if (!current()) return;
      const session = this.#api.useSession(raw);
      if (!session.authenticated) { this.clear('You are signed out. Sign in through the Products basket.'); return; }
      if (!bootstrap && session.customer.id !== this.#identity) {
        this.clear('Your session changed. Recheck to load this account; previous details were removed.'); return;
      }
      this.#identity = session.customer.id;
      this.#set({ authenticated: true });
      await action(ticket.signal, current);
    } catch (error) {
      if (!current()) return;
      if ([401, 403].includes(error.status)) this.clear('Your session needs verification. Sign in again through Products.');
      else if (saving && error.status === 409) this.#set({ conflict: true,
        message: 'Saved defaults changed elsewhere. Your edits are still here. Reload saved defaults to discard them; nothing was overwritten.' });
      else this.#set({ message: saving ? 'Save could not be confirmed. Your edits remain. Reload saved defaults before deciding whether to save again.' :
        'Account information is unavailable. Recheck your session or try again later.' });
      // An uncertain PUT must not be blindly retried with a possibly consumed version.
      if (saving && ![401, 403].includes(error.status)) this.#set({ conflict: true });
    } finally { if (current()) this.#set({ busy: false }); }
  }
  async refresh() {
    this.clear('Rechecking your session…');
    await this.#run(async (signal, current) => {
      const [profile, history] = await Promise.all([
        this.#api.request('/api/account/profile', undefined, signal),
        this.#api.request('/api/account/orders?page=0', undefined, signal)
      ]);
      if (!current()) return;
      this.#set({ profile: validateProfile(profile), history: validateHistory(history, 0),
        message: 'Your website defaults and website orders. Nothing has been changed.' });
    }, { bootstrap: true });
  }
  async reloadProfile() {
    if (!this.#state.authenticated) return;
    await this.#run(async (signal, current) => {
      const value = await this.#api.request('/api/account/profile', undefined, signal);
      if (current()) this.#set({ profile: validateProfile(value), conflict: false, message: 'Saved defaults loaded. Previous form edits discarded.' });
    });
  }
  async save(fields) {
    if (!this.#state.profile || this.#state.conflict || this.#state.busy) return;
    let input;
    try { input = profileInput({ ...fields, version: this.#state.profile.version }); }
    catch { this.#set({ message: 'Enter a one-line name (1–100 characters), address (10–2000 characters), and both preferences. A maximum-version profile cannot be saved again.' }); return; }
    await this.#run(async (signal, current) => {
      const value = await this.#api.request('/api/account/profile', input, signal, 'PUT');
      if (!current()) return;
      const profile = validateProfile(value, { saving: false });
      if (profile.version !== input.version + 1 || ['name', 'address', 'deliveryPreference', 'loafPreference'].some(key => profile[key] !== input[key])) {
        throw new Error('Invalid save response');
      }
      this.#set({ profile, conflict: false, message: 'Website defaults saved. Existing orders and checkout details are unchanged.' });
    }, { saving: true });
  }
  async page(page) {
    if (!this.#state.authenticated || !Number.isInteger(page) || page < 0 || page > 10000) return;
    await this.#run(async (signal, current) => {
      const value = await this.#api.request(`/api/account/orders?page=${page}`, undefined, signal);
      if (current()) this.#set({ history: validateHistory(value, page), detail: null, message: `Website order page ${page + 1} loaded.` });
    });
  }
  async detail(id) {
    if (!this.#state.authenticated || typeof id !== 'string' || !OPAQUE_ID.test(id)) return;
    this.#set({ detail: null });
    await this.#run(async (signal, current) => {
      const value = await this.#api.request(`/api/account/orders/${id}`, undefined, signal);
      if (current()) this.#set({ detail: validateOrderDetail(value, id, this.#now()), message: 'Original website order loaded. This is a read-only snapshot.' });
    });
  }
  async logout() {
    let confirmed = false;
    this.clear('Signing out. Private information has been removed.');
    await this.#run(async (signal, current) => {
      await this.#api.request('/api/auth/logout', undefined, signal);
      if (current()) { confirmed = true; this.clear('You are signed out. Private information has been removed.'); }
    }, { bootstrap: true });
    // Even an unsuccessful logout never restores previously loaded private data.
    if (!confirmed && !this.#state.busy) this.clear('Private information removed. If sign-out could not be confirmed, recheck your session or close this browser.');
  }
}

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const labels = Object.freeze({ CREATING: 'Payment is being prepared — do not place another order',
  UNKNOWN: 'Payment outcome uncertain — contact the bakery before trying again', PAYABLE: 'Awaiting payment', PAID: 'Payment verified',
  REVIEW_REQUIRED: 'Payment needs bakery review', CANCELLED: 'Cancelled', EXPIRED: 'Payment link expired',
  GATE: 'Leave at gate', DOOR: 'Deliver to door', IN_PERSON: 'Hand to me', SLICED: 'Sliced', WHOLE: 'Whole' });

export function attachAccount({ root, api, win = window, doc = document }) {
  const node = (tag, text, className) => {
    const value = doc.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
  };
  const action = (text, handler, className) => {
    const value = node('button', text, className); value.type = 'button'; value.addEventListener('click', handler); return value;
  };
  const status = doc.getElementById('account-status');
  const signin = doc.getElementById('account-signin');
  const recheck = doc.getElementById('account-recheck');
  const logout = doc.getElementById('account-logout');
  let form, fields, save, reload, historyRoot, detailRoot, previousProfile;
  let linkTimer;
  let channel;
  const listeners = [];
  const active = () => !doc.hidden && win.navigator.onLine !== false;
  function erase() {
    clearTimeout(linkTimer);
    // Wipe values as well as detaching: browser form restoration must not revive PII.
    for (const input of root.querySelectorAll('input, select, textarea')) { input.value = ''; input.defaultValue = ''; }
    for (const link of root.querySelectorAll('a')) { link.removeAttribute('href'); link.textContent = ''; }
    root.replaceChildren(); root.hidden = true;
    form = fields = save = reload = historyRoot = detailRoot = previousProfile = null;
  }
  function makeForm() {
    const card = node('section', undefined, 'account-card');
    const heading = node('h2', 'A little less typing next time');
    const help = node('p', 'Save website delivery defaults only. These suggestions are not saved until you choose Save. You still review and accept delivery details for every checkout.', 'account-note');
    form = node('form'); form.autocomplete = 'off';
    fields = {};
    for (const [key, label, max] of [['name', 'Delivery name', 100], ['address', 'One-line delivery address', 2000]]) {
      const wrap = node('label', label, 'account-field'); const input = node('input');
      input.type = 'text'; input.name = key; input.maxLength = max; input.required = true;
      input.minLength = key === 'name' ? 1 : 10; input.autocomplete = 'off';
      wrap.append(input); form.append(wrap); fields[key] = input;
    }
    const choices = node('div', undefined, 'account-choices');
    for (const [key, label, values] of [['deliveryPreference', 'Delivery preference', ['GATE', 'DOOR', 'IN_PERSON']],
      ['loafPreference', 'Loaf preference', ['SLICED', 'WHOLE']]]) {
      const wrap = node('label', label, 'account-field'); const select = node('select'); select.name = key; select.required = true;
      const placeholder = node('option', 'Choose a preference'); placeholder.value = ''; select.append(placeholder);
      for (const value of values) { const option = node('option', labels[value]); option.value = value; select.append(option); }
      wrap.append(select); choices.append(wrap); fields[key] = select;
    }
    save = node('button', 'Save website defaults', 'account-primary'); save.type = 'submit';
    reload = action('Reload saved defaults / discard edits', () => controller.reloadProfile());
    form.append(choices, save, reload);
    form.addEventListener('submit', event => {
      event.preventDefault();
      controller.save(Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])));
    });
    card.append(heading, help, form); root.append(card);
    const orders = node('section', undefined, 'account-card'); orders.append(node('h2', 'From our oven to your table'));
    orders.append(node('p', 'Website orders only — WhatsApp, commercial and subscription orders are not included. Ten orders per page. Original prices, not today’s menu.', 'account-note'));
    historyRoot = node('div'); orders.append(historyRoot); root.append(orders);
    detailRoot = node('section', undefined, 'account-card account-order-detail'); detailRoot.setAttribute('aria-label', 'Original order details');
    root.append(detailRoot);
  }
  function renderHistory(history, busy) {
    historyRoot.replaceChildren();
    if (!history) { historyRoot.append(node('p', 'Website orders have not loaded yet.')); return; }
    if (!history.orders.length) historyRoot.append(node('p', 'No website orders on this page. Your next slow morning starts with the menu.', 'account-empty'));
    for (const order of history.orders) {
      const row = node('article', undefined, 'account-order');
      const info = node('div'); info.append(node('h3', `Order ${order.orderNumber}`),
        node('p', `Placed ${order.createdAt.slice(0, 10)} · Delivery ${order.deliveryDate}`),
        node('p', `${labels[order.status]} · ${order.orderStatus.replaceAll('_', ' ')}`, 'account-note'));
      const open = action('View original order', () => controller.detail(order.id)); open.disabled = busy;
      row.append(info, node('strong', money.format(order.totalAmount)), open); historyRoot.append(row);
    }
    const paging = node('div', undefined, 'account-paging');
    const previous = action('Previous', () => controller.page(history.page - 1)); previous.disabled = busy || history.page === 0;
    const next = action('Next', () => controller.page(history.page + 1)); next.disabled = busy || !history.hasMore || history.page >= 10000;
    paging.append(previous, node('span', `Page ${history.page + 1}`), next); historyRoot.append(paging);
  }
  function renderDetail(detail) {
    clearTimeout(linkTimer);
    detailRoot.replaceChildren(); detailRoot.hidden = !detail;
    if (!detail) return;
    detailRoot.append(node('p', 'ORIGINAL WEBSITE ORDER', 'eyebrow'), node('h2', `Order ${detail.orderNumber}`),
      node('p', `${labels[detail.status]} · ${detail.orderStatus.replaceAll('_', ' ')}`, 'account-state'),
      node('p', `Placed ${detail.createdAt} · Delivery ${detail.quote.date}`),
      node('h3', 'Delivery details accepted for this order'), node('p', detail.fulfillment.name), node('p', detail.fulfillment.address),
      node('p', `${labels[detail.fulfillment.deliveryPreference]} · ${labels[detail.fulfillment.loafPreference]}`),
      node('h3', 'Your original quote'));
    for (const line of detail.quote.lines) detailRoot.append(node('p', `${line.name} · ${line.quantity} × ${money.format(line.unitPrice)} · ${money.format(line.lineTotal)}`));
    for (const [label, key] of [['List subtotal', 'listSubtotal'], ['Discount', 'discountAmount'], ['Batch discount', 'batchDiscountAmount'],
      ['Delivery', 'deliveryCharge'], ['Credit applied', 'creditApplied'], ['Original total', 'totalAmount']]) {
      const row = node('p', undefined, 'account-total'); row.append(node('span', label), node('strong', money.format(detail.quote[key]))); detailRoot.append(row);
    }
    for (const key of ['discountLabel', 'batchDiscountLabel', 'giftLabel']) if (detail.quote[key]) detailRoot.append(node('p', detail.quote[key], 'account-note'));
    detailRoot.append(node('p', 'Read-only historical snapshot. This does not change your basket, reserve delivery again, or create another payment. Only verified server status confirms payment.', 'account-note'));
    if (detail.status === 'PAYABLE' && detail.paymentUrl) {
      const remaining = Date.parse(detail.expiresAt) - Date.now();
      if (remaining <= 0) {
        detailRoot.append(node('p', 'Payment link expired. Recheck the account for current server status.', 'account-note'));
        return;
      }
      const link = node('a', 'Continue this order’s payment ↗', 'account-primary');
      link.href = detail.paymentUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; detailRoot.append(link);
      link.addEventListener('click', event => {
        if (!active() || Date.parse(detail.expiresAt) <= Date.now()) { event.preventDefault(); controller.clear('Payment link needs rechecking.'); }
      });
      linkTimer = setTimeout(() => controller.clear('Payment link expired or needs rechecking. Reload account for current server status.'), Math.min(remaining, 2147483647));
    }
    detailRoot.append(node('p', 'For uncertain or reviewed payments, contact the bakery before placing another order. Never assume a returned payment page means paid.', 'account-note'));
  }
  function render(state) {
    status.textContent = state.message; signin.hidden = state.authenticated;
    logout.hidden = !state.authenticated; logout.disabled = state.busy; recheck.disabled = state.busy;
    root.setAttribute('aria-busy', String(state.busy));
    if (!state.authenticated || !state.profile) { erase(); return; }
    root.hidden = false;
    if (!form) makeForm();
    if (previousProfile !== state.profile) {
      for (const [key, input] of Object.entries(fields)) input.value = state.profile[key];
      previousProfile = state.profile;
    }
    for (const input of Object.values(fields)) input.disabled = state.busy;
    save.disabled = state.busy || state.conflict || state.profile.version === Number.MAX_SAFE_INTEGER;
    reload.disabled = state.busy;
    reload.className = state.conflict ? 'account-conflict' : '';
    renderHistory(state.history, state.busy); renderDetail(state.detail);
  }
  const controller = new AccountController({ api, onChange: render, isActive: active });
  const listen = (target, type, handler) => { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); };
  const recheckSession = () => { if (active()) controller.refresh(); else controller.clear('Offline or paused. Private information has been removed.'); };
  const identityChanged = () => controller.clear('Session changed in another tab. Recheck your session to continue.');
  try { channel = new win.BroadcastChannel('tranche.preview.identity'); channel.onmessage = event => { if (event.data === 'identity-changed') identityChanged(); }; }
  catch { /* Focus/visible rechecks remain mandatory when BroadcastChannel is unavailable. */ }
  listen(recheck, 'click', recheckSession);
  listen(logout, 'click', async () => {
    channel?.postMessage('identity-changed');
    try { await controller.logout(); } finally { channel?.postMessage('identity-changed'); }
  });
  listen(win, 'offline', () => controller.clear('Offline. Private information has been removed. Reconnect, then recheck your session.'));
  listen(win, 'online', recheckSession);
  listen(win, 'focus', recheckSession);
  listen(doc, 'visibilitychange', recheckSession);
  listen(win, 'pagehide', () => controller.clear());
  listen(win, 'pageshow', recheckSession);
  listen(win, 'storage', identityChanged); // Never read or write browser persistence.
  render(controller.state);
  recheckSession();
  return { controller, destroy() { listeners.forEach(remove => remove()); channel?.close(); controller.clear(); } };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && checkoutEnabled(window.TRANCHE_STOREFRONT)) {
  const root = document.getElementById('account-private');
  if (root) attachAccount({ root, api: new StorefrontApi(undefined, { checkoutEnabled: true }) });
}