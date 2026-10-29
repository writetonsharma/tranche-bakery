import { StorefrontApi } from './api.mjs';
import { LatestRequest, appendQuoteLine } from './model.mjs';
import { checkoutEnabled, OPAQUE_ID } from './checkout-model.mjs';
import { validateProfile, profileInput, validateHistory, validateOrderDetail, validateLocation } from './account-model.mjs';
import { validateCurrent } from './subscription-model.mjs';
import { createLogin } from './login.mjs';

const SIGN_IN = 'Sign in with your WhatsApp number to see your account.';
const empty = () => ({ authenticated: false, profile: null, history: null, detail: null,
  location: null, locationMessage: '', historyMessage: '',
  subscription: undefined, subscriptionMessage: '',
  busy: false, conflict: false, message: SIGN_IN });

// Private data and identity live only in this instance; never in URLs or storage.
export class AccountController {
  #api; #latest = new LatestRequest(); #identity = null; #change; #active; #now;
  #state = Object.freeze(empty());
  #refreshFlight = null;
  constructor({ api, onChange = () => {}, isActive = () => true, now = () => Date.now() }) {
    this.#api = api; this.#change = onChange; this.#active = isActive; this.#now = now;
  }
  get state() { return this.#state; }
  #set(patch) { this.#state = Object.freeze({ ...this.#state, ...patch }); this.#change(this.#state); }
  clear(message = 'Refresh your account to continue.') {
    this.#refreshFlight = null;
    this.#latest.invalidate(); this.#identity = null; this.#api.clearSession();
    this.#state = Object.freeze({ ...empty(), message }); this.#change(this.#state);
  }
  async #run(action, { bootstrap = false, saving = false, history = false, quiet = false } = {}) {
    if (!this.#active() || this.#state.busy) return;
    const ticket = this.#latest.begin();
    const current = () => this.#latest.current(ticket) && this.#active();
    this.#set({ busy: true, ...(quiet ? {} : history ? { historyMessage: 'Loading orders…' } : { message: 'Loading…' }) });
    try {
      const raw = await this.#api.request('/api/session', undefined, ticket.signal);
      if (!current()) return;
      const session = this.#api.useSession(raw);
      if (!session.authenticated) { this.clear(SIGN_IN); return; }
      if (!bootstrap && session.customer.id !== this.#identity) {
        this.clear('Sign-in changed. Refresh your account.'); return;
      }
      this.#identity = session.customer.id;
      this.#set({ authenticated: true });
      await action(ticket.signal, current);
    } catch (error) {
      if (!current()) return;
      if ([401, 403].includes(error.status)) this.clear('Please sign in again.');
      else if (quiet) { /* A failed background recheck keeps what is already shown. */ }
      else if (history) this.#set({ history: null, detail: null,
        historyMessage: 'Orders unavailable. Try loading orders again.' });
      else if (saving && error.status === 409) this.#set({ conflict: true,
        message: 'Saved details changed elsewhere. Your edits are kept here. Reload to discard edits and see saved details.' });
      else this.#set({ message: saving ? 'Save not confirmed. Your edits are kept here. Reload saved details before saving again; this discards edits.' :
        'Account unavailable. Refresh or try again later.' });
      // An uncertain PUT must not be blindly retried with a possibly consumed version.
      if (saving && ![401, 403].includes(error.status)) this.#set({ conflict: true });
    } finally { if (current()) this.#set({ busy: false }); }
  }
  async refresh() {
    if (this.#refreshFlight) return this.#refreshFlight;
    // Same signed-in customer regaining focus: only recheck the session, keeping loaded data and edits.
    if (this.#state.authenticated && this.#identity !== null) {
      const recheck = this.#run(async () => {}, { quiet: true });
      this.#refreshFlight = recheck;
      try { await recheck; } finally { if (this.#refreshFlight === recheck) this.#refreshFlight = null; }
      return;
    }
    this.clear('Loading your account…');
    const loading = this.#load();
    this.#refreshFlight = loading;
    try { await loading; } finally { if (this.#refreshFlight === loading) this.#refreshFlight = null; }
  }
  async #load() {
    await this.#run(async (signal, current) => {
      const profile = await this.#api.request('/api/account/profile', undefined, signal);
      if (!current()) return;
      this.#set({ profile: validateProfile(profile), message: '' });
      try {
        const location = validateLocation(await this.#api.request('/api/account/location', undefined, signal));
        if (current()) this.#set({ location, locationMessage: location ? '' : 'No saved delivery pin.' });
      } catch (error) {
        if ([401, 403].includes(error.status)) throw error;
        if (current()) this.#set({ location: null, locationMessage: 'Saved delivery pin unavailable.' });
      }
      try {
        const subscription = validateCurrent(await this.#api.request('/api/subscriptions/current', undefined, signal));
        if (current()) this.#set({ subscription, subscriptionMessage: '' });
      } catch (error) {
        if ([401, 403].includes(error.status)) throw error;
        if (current()) this.#set({ subscription: undefined, subscriptionMessage: 'Subscription details unavailable. Refresh your account to try again.' });
      }
    }, { bootstrap: true });
    if (this.#state.authenticated && !this.#state.history) await this.page(0);
  }
  async reloadProfile() {
    if (!this.#state.authenticated) return;
    await this.#run(async (signal, current) => {
      const value = await this.#api.request('/api/account/profile', undefined, signal);
      if (current()) this.#set({ profile: validateProfile(value), conflict: false, message: 'Saved details loaded. Edits discarded.' });
    });
  }
  async save(fields) {
    if (!this.#state.profile || this.#state.conflict || this.#state.busy) return;
    let input;
    try { input = profileInput({ ...fields, version: this.#state.profile.version }); }
    catch { this.#set({ message: 'Check your name (1–100 characters), one-line address (10–2000 characters) and both preferences. If saving stays unavailable, contact the bakery.' }); return; }
    await this.#run(async (signal, current) => {
      const value = await this.#api.request('/api/account/profile', input, signal, 'PUT');
      if (!current()) return;
      const profile = validateProfile(value, { saving: false });
      if (profile.version !== input.version + 1 || ['name', 'address', 'deliveryPreference', 'loafPreference'].some(key => profile[key] !== input[key])) {
        throw new Error('Invalid save response');
      }
      this.#set({ profile, conflict: false, message: 'Saved. Existing orders are unchanged.' });
    }, { saving: true });
  }
  async page(page) {
    if (!this.#state.authenticated || !Number.isInteger(page) || page < 0 || page > 10000) return;
    await this.#run(async (signal, current) => {
      const value = await this.#api.request(`/api/account/orders?page=${page}`, undefined, signal);
      if (current()) this.#set({ history: validateHistory(value, page), detail: null, historyMessage: '' });
    }, { history: true });
  }
  async detail(id) {
    if (!this.#state.authenticated || typeof id !== 'string' || !OPAQUE_ID.test(id)) return;
    this.#set({ detail: null });
    await this.#run(async (signal, current) => {
      const value = await this.#api.request(`/api/account/orders/${id}`, undefined, signal);
      if (current()) this.#set({ detail: validateOrderDetail(value, id, this.#now()), historyMessage: 'Order details loaded.' });
    }, { history: true });
  }
  async logout() {
    let confirmed = false;
    this.clear('Signing out. Private information has been removed.');
    await this.#run(async (signal, current) => {
      await this.#api.request('/api/auth/logout', undefined, signal);
      if (current()) { confirmed = true; this.clear('You are signed out. Private information has been removed.'); }
    }, { bootstrap: true });
    // Even an unsuccessful logout never restores previously loaded private data.
    if (!confirmed && !this.#state.busy) this.clear('Sign-out not confirmed. Details hidden; refresh or close this browser.');
  }
}

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const labels = Object.freeze({ CREATING: 'Payment is being prepared — do not place another order',
  UNKNOWN: 'Payment outcome uncertain — contact the bakery before trying again', PAYABLE: 'Awaiting payment', PAID: 'Payment verified',
  REVIEW_REQUIRED: 'Payment needs bakery review', CANCELLED: 'Cancelled', EXPIRED: 'Payment link expired',
  GATE: 'Leave at gate', DOOR: 'Deliver to door', IN_PERSON: 'Hand to me', SLICED: 'Sliced', WHOLE: 'Whole' });
const orderLabels = Object.freeze({ INVOICED: 'Invoice sent', PENDING_CONFIRMATION: 'Awaiting confirmation',
  PENDING_PAYMENT_SCREENSHOT: 'Awaiting payment confirmation', PAYMENT_SCREENSHOT_RECEIVED: 'Payment being checked',
  PAYMENT_SCREENSHOT_VERIFIED: 'Payment checked', PAYMENT_REVIEW_REQUIRED: 'Payment needs review',
  CONFIRMED: 'Confirmed', IN_BAKING: 'Baking', OUT_FOR_DELIVERY: 'Out for delivery',
  CANCELLED: 'Cancelled', COMPLETED: 'Completed', SCHEDULED: 'Scheduled' });
const subscriptionLabels = Object.freeze({ ACTIVE: 'Active', COMPLETED: 'Completed', CANCELLED: 'Cancelled' });
const dayName = day => day.charAt(0) + day.slice(1).toLowerCase();
const shortDate = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const prettyDate = value => shortDate.format(new Date(`${value}T00:00:00Z`));

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
  const logout = doc.getElementById('account-logout');
  const shop = doc.getElementById('account-shop');
  let form, fields, save, reload, locationRoot, subscriptionRoot, historyRoot, detailRoot, previousProfile;
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
    form = fields = save = reload = locationRoot = subscriptionRoot = historyRoot = detailRoot = previousProfile = null;
  }
  function makeForm() {
    const card = node('section', undefined, 'account-card');
    const heading = node('h2', 'A little less typing next time');
    const help = node('p', 'Save delivery details for next time. Review them at checkout.', 'account-note');
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
    save = node('button', 'Save details', 'account-primary'); save.type = 'submit';
    reload = action('Discard changes and load saved details', () => controller.reloadProfile());
    form.append(choices, save, reload);
    form.addEventListener('submit', event => {
      event.preventDefault();
      controller.save(Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])));
    });
    locationRoot = node('div');
    card.append(heading, help, form, locationRoot);
    subscriptionRoot = node('section', undefined, 'account-card account-subscription');
    subscriptionRoot.setAttribute('aria-label', 'Weekly subscription'); root.append(subscriptionRoot, card);
    const orders = node('section', undefined, 'account-card'); orders.append(node('h2', 'From our oven to your table'));
    orders.append(node('p', 'Website and WhatsApp orders, and weekly subscriptions. Website orders open to their original details.', 'account-note'));
    historyRoot = node('div'); orders.append(historyRoot); root.append(orders);
    detailRoot = node('section', undefined, 'account-card account-order-detail'); detailRoot.setAttribute('aria-label', 'Original order details');
    root.append(detailRoot);
  }
  function renderSubscription(subscription, message) {
    for (const link of subscriptionRoot.querySelectorAll('a')) link.removeAttribute('href');
    subscriptionRoot.replaceChildren(node('p', 'SUBSCRIPTIONS', 'eyebrow'));
    const start = node('a', 'Start a weekly subscription', 'account-primary'); start.href = 'subscribe.html';
    if (subscription === undefined) {
      subscriptionRoot.append(node('h2', 'Fresh bread, every week'), node('p', message || 'Checking your subscription…', 'account-note'));
      return;
    }
    if (subscription === null) {
      subscriptionRoot.append(node('h2', 'Fresh bread, every week'),
        node('p', 'Choose a bake and a delivery day. Pay once for the weeks ahead; one week is on us.', 'account-note'), start);
      return;
    }
    const pending = subscription.status === 'PENDING_PAYMENT';
    subscriptionRoot.append(node('h2', subscription.planName),
      node('p', pending ? 'Awaiting payment' : `Active · every ${dayName(subscription.deliveryDay)} · ${prettyDate(subscription.startDate)} to ${prettyDate(subscription.endDate)}`, 'account-state'));
    for (const item of subscription.items) subscriptionRoot.append(node('p', `${item.quantity} × ${item.name}${item.portion === 'HALF' ? ' (half)' : ''}`));
    const total = node('p', undefined, 'account-total');
    total.append(node('span', `${subscription.paidWeeks + subscription.freeWeeks} weeks · ${subscription.freeWeeks} on us`), node('strong', money.format(subscription.amount)));
    subscriptionRoot.append(total);
    if (pending) {
      const open = node('a', 'Continue on the Subscriptions page', 'account-primary'); open.href = 'subscribe.html';
      subscriptionRoot.append(node('p', 'Delivery dates are fixed once payment is confirmed.', 'account-note'), open);
      return;
    }
    subscriptionRoot.append(node('h3', 'Deliveries'));
    const list = node('ol', undefined, 'account-deliveries');
    for (const row of subscription.deliveries) list.append(node('li', `${prettyDate(row.date)} · ${orderLabels[row.status]}`));
    subscriptionRoot.append(list);
    if (subscription.fulfillment) {
      subscriptionRoot.append(node('h3', 'Delivering to'), node('p', subscription.fulfillment.name), node('p', subscription.fulfillment.address),
        node('p', `${labels[subscription.fulfillment.deliveryPreference]} · ${labels[subscription.fulfillment.loafPreference]}`));
    }
    subscriptionRoot.append(node('p', 'To change, pause or skip a week, message the bakery on WhatsApp.', 'account-note'));
  }
  function renderHistory(history, busy, message) {
    historyRoot.replaceChildren();
    if (message) {
      const notice = node('p', message); notice.setAttribute('role', 'status'); historyRoot.append(notice);
    }
    if (!history) {
      const load = action('Load your orders', () => controller.page(0)); load.disabled = busy;
      historyRoot.append(load); return;
    }
    if (!history.orders.length) historyRoot.append(node('p', 'No orders on this page. Your next slow morning starts with the menu.', 'account-empty'));
    for (const order of history.orders) {
      const row = node('article', undefined, 'account-order');
      if (order.channel === 'SUBSCRIPTION') {
        const sub = order.subscription;
        const info = node('div'); info.append(node('h3', `Subscription · ${sub.planName}`),
          node('p', `Every ${dayName(sub.deliveryDay)} · ${prettyDate(sub.startDate)} to ${prettyDate(sub.endDate)}`),
          node('p', `${subscriptionLabels[order.status]} · ${sub.delivered} of ${sub.weeks} weeks delivered`, 'account-note'));
        row.append(info);
        if (order.totalAmount !== null) row.append(node('strong', money.format(order.totalAmount)));
        historyRoot.append(row); continue;
      }
      const whatsapp = order.channel === 'WHATSAPP';
      const placed = `Placed ${order.createdAt.slice(0, 10)}${order.deliveryDate ? ` · Delivery ${order.deliveryDate}` : ''}`;
      const info = node('div'); info.append(node('h3', `Order ${order.orderNumber}`), node('p', placed),
        node('p', `${whatsapp ? 'Ordered on WhatsApp' : labels[order.status]} · ${orderLabels[order.orderStatus]}`, 'account-note'));
      row.append(info);
      if (order.totalAmount !== null) row.append(node('strong', money.format(order.totalAmount)));
      if (!whatsapp) {
        const open = action('View original order', () => controller.detail(order.id)); open.disabled = busy; row.append(open);
      }
      historyRoot.append(row);
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
      node('p', `${labels[detail.status]} · ${orderLabels[detail.orderStatus]}`, 'account-state'),
      node('p', `Placed ${detail.createdAt} · Delivery ${detail.quote.date}`),
      node('h3', 'Delivery details accepted for this order'), node('p', detail.fulfillment.name), node('p', detail.fulfillment.address),
      node('p', `${labels[detail.fulfillment.deliveryPreference]} · ${labels[detail.fulfillment.loafPreference]}`),
      node('h3', 'Order total'));
    for (const line of detail.quote.lines) detailRoot.append(appendQuoteLine(node('p'), line, money, node));
    for (const [label, key] of [['List subtotal', 'listSubtotal'], ['Discount', 'discountAmount'], ['Batch discount', 'batchDiscountAmount'],
      ['Delivery', 'deliveryCharge'], ['Credit applied', 'creditApplied'], ['Original total', 'totalAmount']]) {
      const row = node('p', undefined, 'account-total'); row.append(node('span', label), node('strong', money.format(detail.quote[key]))); detailRoot.append(row);
    }
    for (const key of ['discountLabel', 'batchDiscountLabel', 'giftLabel']) if (detail.quote[key]) detailRoot.append(node('p', detail.quote[key], 'account-note'));
    detailRoot.append(node('p', 'Original order details. Viewing them does not place another order.', 'account-note'));
    if (detail.status === 'PAYABLE' && detail.paymentUrl) {
      const remaining = Date.parse(detail.expiresAt) - Date.now();
      if (remaining <= 0) {
        detailRoot.append(node('p', 'Payment link expired. Refresh your account to check payment status.', 'account-note'));
        return;
      }
      const link = node('a', 'Continue this order’s payment ↗', 'account-primary');
      link.href = detail.paymentUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; detailRoot.append(link);
      link.addEventListener('click', event => {
        if (!active() || Date.parse(detail.expiresAt) <= Date.now()) { event.preventDefault(); controller.clear('Payment link needs rechecking.'); }
      });
      linkTimer = setTimeout(() => controller.clear('Payment link expired. Refresh your account to check payment status.'), Math.min(remaining, 2147483647));
    }
    detailRoot.append(node('p', 'Payment uncertain or under review? Contact the bakery before ordering or paying again. Returning from payment does not confirm it.', 'account-note'));
  }
  function render(state) {
    status.textContent = state.message; signin.hidden = state.authenticated;
    for (const label of doc.querySelectorAll?.('[data-account-label]') || []) label.textContent = state.authenticated ? 'Account' : 'Sign in';
    logout.hidden = !state.authenticated; logout.disabled = state.busy;
    if (shop) shop.hidden = !state.authenticated;
    root.setAttribute('aria-busy', String(state.busy));
    if (!state.authenticated) { erase(); return; }
    root.hidden = false;
    if (!form) makeForm();
    if (state.profile && previousProfile !== state.profile) {
      for (const [key, input] of Object.entries(fields)) input.value = state.profile[key];
      previousProfile = state.profile;
    }
    for (const input of Object.values(fields)) input.disabled = state.busy || !state.profile;
    save.disabled = state.busy || !state.profile || state.conflict || state.profile.version === Number.MAX_SAFE_INTEGER;
    reload.disabled = state.busy;
    reload.hidden = !!state.profile && !state.conflict;
    reload.textContent = state.profile ? 'Discard changes and load saved details' : 'Try saved details again';
    reload.className = state.conflict ? 'account-conflict' : '';
    for (const link of locationRoot.querySelectorAll('a')) { link.removeAttribute('href'); link.textContent = ''; }
    locationRoot.replaceChildren();
    if (state.location) {
      locationRoot.append(node('h3', 'Saved delivery pin'));
      const link = node('a', 'View saved pin in Maps ↗');
      link.href = `https://www.google.com/maps?q=${state.location.latitude},${state.location.longitude}`;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      locationRoot.append(link, node('p', 'Saved with the bakery. This page does not change your pin.', 'account-note'));
    } else if (state.locationMessage) locationRoot.append(node('p', state.locationMessage, 'account-note'));
    renderSubscription(state.subscription, state.subscriptionMessage);
    renderHistory(state.history, state.busy, state.historyMessage); renderDetail(state.detail);
  }
  const controller = new AccountController({ api, onChange: render, isActive: active });
  const login = createLogin({ doc, mount: signin, api, notify: message => channel?.postMessage(message),
    onVerified: () => controller.refresh() });
  const listen = (target, type, handler) => { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); };
  const recheckSession = () => { if (active()) controller.refresh(); else controller.clear('Offline or paused. Private information has been removed.'); };
  const identityChanged = () => controller.clear('Sign-in changed in another tab. Refresh your account.');
  try { channel = new win.BroadcastChannel('tranche.preview.identity'); channel.onmessage = event => { if (event.data === 'identity-changed') identityChanged(); }; }
  catch { /* Focus/visible rechecks remain mandatory when BroadcastChannel is unavailable. */ }
  listen(logout, 'click', async () => {
    channel?.postMessage('identity-changed');
    try { await controller.logout(); } finally { channel?.postMessage('identity-changed'); }
  });
  listen(win, 'offline', () => controller.clear('Offline. Details hidden. Reconnect and refresh your account.'));
  listen(win, 'online', recheckSession);
  listen(win, 'focus', recheckSession);
  listen(doc, 'visibilitychange', recheckSession);
  listen(win, 'pagehide', () => { login?.wipe(); controller.clear(); });
  listen(win, 'pageshow', recheckSession);
  listen(win, 'storage', identityChanged); // Never read or write browser persistence.
  render(controller.state);
  recheckSession();
  return { controller, destroy() { listeners.forEach(remove => remove()); channel?.close(); login?.wipe(); controller.clear(); } };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && checkoutEnabled(window.TRANCHE_STOREFRONT)) {
  const root = document.getElementById('account-private');
  if (root) attachAccount({ root, api: new StorefrontApi(undefined, { checkoutEnabled: true }) });
}