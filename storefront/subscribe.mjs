import { StorefrontApi } from './api.mjs';
import { LatestRequest } from './model.mjs';
import { checkoutEnabled, problemMessage } from './checkout-model.mjs';
import { validateProfile } from './account-model.mjs';
import { validatePlans, validateCurrent, subscriptionInput } from './subscription-model.mjs';
import { createLogin } from './login.mjs';

const UNAVAILABLE = 'Subscriptions are unavailable right now. Refresh, or message the bakery on WhatsApp.';
const initial = () => ({ authenticated: false, customer: null, plans: null, current: undefined, profile: null,
  busy: false, message: 'Loading plans…' });
const auth = error => [401, 403].includes(error?.status);

// Private data and identity live only in this instance; never in URLs or storage.
export class SubscribeController {
  #api; #latest = new LatestRequest(); #change; #active; #identity = null; #reloadPlans = false; #loading = null;
  #state = Object.freeze(initial());
  constructor({ api, onChange = () => {}, isActive = () => true }) {
    this.#api = api; this.#change = onChange; this.#active = isActive;
  }
  get state() { return this.#state; }
  #set(patch) { this.#state = Object.freeze({ ...this.#state, ...patch }); this.#change(this.#state); }
  clear(message = 'Refresh the page to continue.') {
    this.#latest.invalidate(); this.#identity = null; this.#api.clearSession();
    this.#state = Object.freeze({ ...initial(), message }); this.#change(this.#state);
  }
  async #session(signal) { return this.#api.useSession(await this.#api.request('/api/session', undefined, signal)); }
  async #current(signal) { return validateCurrent(await this.#api.request('/api/subscriptions/current', undefined, signal)); }

  // Plans for whoever is signed in (F&F customers see their own plans), then their open subscription.
  async load() {
    if (!this.#active() || this.#state.busy || (this.#loading && this.#latest.current(this.#loading))) return;
    const ticket = this.#latest.begin();
    const current = () => this.#latest.current(ticket) && this.#active();
    this.#loading = ticket;
    try {
      const session = await this.#session(ticket.signal);
      if (!current()) return;
      const id = session.authenticated ? session.customer.id : null;
      if (this.#state.plans && id === this.#identity && !this.#reloadPlans) {
        // Same visitor returning (for example from the payment page): only the subscription can have changed.
        // This refresh leaves the form usable; a reservation started meanwhile supersedes it.
        if (id === null) return;
        const before = this.#state.current;
        const value = await this.#current(ticket.signal);
        if (!current()) return;
        const paid = before?.status === 'PENDING_PAYMENT' && value?.status === 'ACTIVE';
        this.#set({ current: value, ...(paid ? { message: 'Payment confirmed. Your subscription is active.' } : {}) });
        return;
      }
      this.#set({ busy: true });
      // A different customer never sees the previous one's subscription or details, even if loading fails.
      if (this.#identity !== null && id !== this.#identity) {
        this.#identity = null; this.#set({ authenticated: false, customer: null, current: undefined, profile: null });
      }
      const plans = validatePlans(await this.#api.request('/api/subscriptions/plans', undefined, ticket.signal));
      if (!current()) return;
      let subscription = null, profile = null;
      if (id !== null) {
        subscription = await this.#current(ticket.signal);
        if (!current()) return;
        if (!subscription) {
          try { profile = validateProfile(await this.#api.request('/api/account/profile', undefined, ticket.signal)); }
          catch (error) { if (auth(error)) throw error; /* Details can still be typed in. */ }
          if (!current()) return;
        }
      }
      const message = this.#state.message === 'Loading plans…' || this.#state.message === UNAVAILABLE ? '' : this.#state.message;
      this.#identity = id; this.#reloadPlans = false;
      this.#set({ authenticated: id !== null, customer: id, plans, current: subscription, profile, message });
    } catch (error) {
      if (!current()) return;
      if (auth(error)) this.clear('Please sign in again.');
      else this.#set({ message: UNAVAILABLE });
    } finally {
      if (this.#loading === ticket) this.#loading = null;
      if (current() && this.#state.busy) this.#set({ busy: false });
    }
  }

  async submit(value) {
    const state = this.#state;
    if (state.busy || !state.authenticated || state.current) return;
    let input;
    try { input = subscriptionInput(value, state.plans); }
    catch {
      this.#set({ message: 'Choose a plan, a bake for each part and a delivery day, then add your name (1–100 characters), a one-line address (10–2000 characters) and both preferences.' });
      return;
    }
    await this.#write(signal => this.#api.request('/api/subscriptions', input, signal),
      'Reserved. Pay below to confirm your subscription.');
  }

  async cancel() {
    if (this.#state.busy || this.#state.current?.status !== 'PENDING_PAYMENT') return;
    await this.#write(signal => this.#api.request('/api/subscriptions/current/cancel', undefined, signal),
      'Request cancelled. No payment was taken.');
  }

  // A write is never retried: an uncertain outcome is resolved by re-reading the subscription.
  async #write(send, done) {
    if (!this.#active()) return;
    const ticket = this.#latest.begin();
    const current = () => this.#latest.current(ticket) && this.#active();
    const identity = this.#identity;
    let recheck = false;
    this.#set({ busy: true, message: 'Working…' });
    try {
      const session = await this.#session(ticket.signal);
      if (!current()) return;
      if (!session.authenticated || session.customer.id !== identity) { this.clear('Sign-in changed. Refresh the page.'); return; }
      const value = validateCurrent(await send(ticket.signal));
      if (!current()) return;
      this.#set({ current: value, message: value?.status === 'PENDING_PAYMENT' && !value.paymentUrl ?
        'Payment link unavailable. Cancel this request and try again later, or message the bakery.' : done });
    } catch (error) {
      if (!current()) return;
      if (auth(error)) { this.clear('Please sign in again.'); return; }
      if (['PLAN_UNAVAILABLE', 'ITEM_UNAVAILABLE'].includes(error.code)) this.#reloadPlans = true;
      this.#set({ message: error.code ? problemMessage(error.code) : 'Not confirmed. Check your subscription below before trying again.' });
      recheck = true;
    } finally { if (current()) this.#set({ busy: false }); }
    if (recheck) await this.load();
  }
}

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const prettyDate = value => shortDate.format(new Date(`${value}T00:00:00Z`));
const dayName = day => day.charAt(0) + day.slice(1).toLowerCase();
const KINDS = Object.freeze({ LOAF: 'Loaf', ROLL: 'Rolls', SWEET: 'Sweet roll' });
const PREFERENCES = Object.freeze({ GATE: 'Leave at gate', DOOR: 'Deliver to door', IN_PERSON: 'Hand to me', SLICED: 'Sliced', WHOLE: 'Whole' });
const DELIVERY = Object.freeze({ SCHEDULED: 'Scheduled', CONFIRMED: 'Confirmed', IN_BAKING: 'Baking',
  OUT_FOR_DELIVERY: 'Out for delivery', COMPLETED: 'Delivered', CANCELLED: 'Cancelled' });
const cents = value => Math.round(value * 100);
const component = part => `${part.quantity} × ${KINDS[part.type] || part.type}${part.portion === 'HALF' ? ' (half)' : ''}`;

export function attachSubscribe({ root, api, win = window, doc = document }) {
  const node = (tag, text, className) => {
    const value = doc.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
  };
  const action = (text, handler, className) => {
    const value = node('button', text, className); value.type = 'button'; value.addEventListener('click', handler); return value;
  };
  const status = doc.getElementById('subscribe-status');
  const listeners = [];
  let channel, builtPlans = null, shownCustomer = null, filledFor = null;
  const selection = { plan: null, option: null, items: [], day: null };
  const active = () => !doc.hidden && win.navigator.onLine !== false;

  const currentRoot = node('section', undefined, 'account-card subscribe-current');
  currentRoot.setAttribute('aria-label', 'Your subscription');
  // A plain container, not a form: the sign-in step mounts its own form inside it.
  const form = node('div', undefined, 'subscribe-builder');
  const step = (title, note) => {
    const set = node('fieldset', undefined, 'account-card subscribe-step');
    set.append(node('legend', title)); if (note) set.append(node('p', note, 'account-note'));
    form.append(set); return set;
  };
  const planStep = step('1. Choose your bake');
  const audience = node('p', '', 'account-note'); planStep.append(audience);
  const planList = node('div', undefined, 'subscribe-options'); planStep.append(planList);
  const optionStep = step('2. Choose what comes each week');
  const optionList = node('div', undefined, 'subscribe-options'); optionStep.append(optionList);
  const itemList = node('div', undefined, 'account-choices'); optionStep.append(itemList);
  const dayStep = step('3. Choose your delivery day', 'Dates are fixed when payment is confirmed.');
  const dayList = node('div', undefined, 'subscribe-options'); dayStep.append(dayList);
  const detailStep = step('4. Your delivery details');
  const loginRoot = node('div', undefined, 'subscribe-login');
  loginRoot.append(node('p', 'Sign in with your WhatsApp number so we can link the subscription to you.', 'account-note'));
  const loginMount = node('div'); loginRoot.append(loginMount);
  const detailRoot = node('div');
  const fields = {};
  for (const [key, label, max, min] of [['name', 'Delivery name', 100, 1], ['address', 'One-line delivery address', 2000, 10]]) {
    const wrap = node('label', label, 'account-field'); const input = node('input');
    input.type = 'text'; input.name = key; input.maxLength = max; input.minLength = min; input.required = true; input.autocomplete = 'off';
    wrap.append(input); detailRoot.append(wrap); fields[key] = input;
  }
  const choices = node('div', undefined, 'account-choices');
  for (const [key, label, values] of [['deliveryPreference', 'Delivery preference', ['GATE', 'DOOR', 'IN_PERSON']],
    ['loafPreference', 'Loaf preference', ['SLICED', 'WHOLE']]]) {
    const wrap = node('label', label, 'account-field'); const select = node('select'); select.name = key; select.required = true;
    const placeholder = node('option', 'Choose a preference'); placeholder.value = ''; select.append(placeholder);
    for (const value of values) { const option = node('option', PREFERENCES[value]); option.value = value; select.append(option); }
    wrap.append(select); choices.append(wrap); fields[key] = select;
  }
  detailRoot.append(choices);
  detailStep.append(loginRoot, detailRoot);
  const summary = node('section', undefined, 'account-card subscribe-summary'); summary.setAttribute('aria-live', 'polite');
  const summaryLines = node('div');
  const submit = node('button', 'Reserve and pay', 'account-primary'); submit.type = 'button';
  summary.append(node('h2', 'Your subscription'), summaryLines, submit,
    node('p', 'Pay once for every week. The first delivery shown needs payment before 5 PM; pay later and it moves to the next week. Unpaid requests are cancelled at 8 PM.', 'account-note'));
  form.append(summary);
  root.append(currentRoot, form);

  const controller = new SubscribeController({ api, onChange: render, isActive: active });
  const login = createLogin({ doc, mount: loginMount, api, notify: message => channel?.postMessage(message),
    onVerified: () => controller.load() });

  const plan = () => builtPlans?.plans.find(row => row.code === selection.plan) || null;
  const option = () => plan()?.options.find(row => row.index === selection.option) || null;
  function radio(list, name, value, title, note, checked, onSelect) {
    const label = node('label', undefined, 'subscribe-option'); const input = node('input');
    input.type = 'radio'; input.name = name; input.value = String(value); input.checked = checked;
    input.addEventListener('change', () => { if (input.checked) onSelect(); });
    const text = node('span'); text.append(node('strong', title)); if (note) text.append(node('small', note));
    label.append(input, text); list.append(label);
  }
  function buildItems() {
    itemList.replaceChildren();
    const chosen = option();
    if (!chosen) { selection.items = []; return; }
    selection.items = chosen.components.map((part, index) => part.choices.includes(selection.items[index]) ? selection.items[index] : '');
    chosen.components.forEach((part, index) => {
      const same = chosen.components.filter(other => component(other) === component(part));
      const title = same.length > 1 ? `${component(part)} · choice ${same.indexOf(part) + 1}` : component(part);
      const wrap = node('label', title, 'account-field'); const select = node('select'); select.name = `item-${index}`; select.required = true;
      const placeholder = node('option', 'Choose a bake'); placeholder.value = ''; select.append(placeholder);
      for (const name of part.choices) { const entry = node('option', name); entry.value = name; select.append(entry); }
      select.value = selection.items[index];
      select.addEventListener('change', () => { selection.items[index] = select.value; renderSummary(); });
      wrap.append(select); itemList.append(wrap);
    });
  }
  function buildOptions() {
    optionList.replaceChildren();
    const chosen = plan();
    if (!chosen) { selection.option = null; buildItems(); return; }
    if (!chosen.options.some(row => row.index === selection.option)) selection.option = chosen.options[0].index;
    for (const row of chosen.options) {
      radio(optionList, 'option', row.index, row.label, row.description || row.components.map(component).join(' + '),
        row.index === selection.option, () => { selection.option = row.index; buildItems(); renderSummary(); });
    }
    buildItems();
  }
  function buildPlans(plans) {
    builtPlans = plans;
    planList.replaceChildren(); dayList.replaceChildren();
    audience.textContent = plans.audience === 'FF' ? 'Friends & family plans for your account.' : '';
    if (!plans.plans.some(row => row.code === selection.plan)) selection.plan = plans.plans[0]?.code ?? null;
    for (const row of plans.plans) {
      radio(planList, 'plan', row.code, `${row.name} · ${money.format(row.weeklyPrice)} a week`,
        `${row.paidWeeks} weeks paid${row.freeWeeks ? ` + ${row.freeWeeks} on us` : ''} · delivery ${money.format(row.deliveryCharge)} a week`,
        row.code === selection.plan, () => { selection.plan = row.code; buildOptions(); renderSummary(); });
    }
    if (!plans.days.some(row => row.day === selection.day)) selection.day = null;
    for (const row of plans.days) {
      radio(dayList, 'day', row.day, `${dayName(row.day)}s`, `First delivery ${prettyDate(row.firstDelivery)} if paid by 5 PM today`,
        row.day === selection.day, () => { selection.day = row.day; renderSummary(); });
    }
    buildOptions();
  }
  function renderSummary() {
    summaryLines.replaceChildren();
    const chosen = plan();
    if (!chosen) return;
    const weeks = chosen.paidWeeks + chosen.freeWeeks;
    const line = (label, value) => { const row = node('p', undefined, 'account-total'); row.append(node('span', label), node('strong', value)); summaryLines.append(row); };
    summaryLines.append(node('p', chosen.name, 'account-state'));
    const bake = option();
    if (bake) summaryLines.append(node('p', `${bake.label}${selection.items.every(Boolean) ? ` · ${selection.items.join(', ')}` : ''}`));
    if (selection.day) summaryLines.append(node('p', `Every ${dayName(selection.day)} for ${weeks} weeks`));
    if (cents(chosen.weeklyPrice) * chosen.paidWeeks + cents(chosen.deliveryCharge) * weeks === cents(chosen.upfront)) {
      line(`Bakes, ${chosen.paidWeeks} weeks × ${money.format(chosen.weeklyPrice)}`, money.format(chosen.weeklyPrice * chosen.paidWeeks));
      if (chosen.freeWeeks) line(`Bakes, ${chosen.freeWeeks} week${chosen.freeWeeks > 1 ? 's' : ''} on us`, money.format(0));
      line(`Delivery, ${weeks} weeks × ${money.format(chosen.deliveryCharge)}`, money.format(chosen.deliveryCharge * weeks));
    }
    line('Pay once', money.format(chosen.upfront));
    submit.textContent = `Reserve and pay ${money.format(chosen.upfront)}`;
  }
  function wipeDetails() {
    for (const input of Object.values(fields)) { input.value = ''; input.defaultValue = ''; }
    filledFor = null;
  }
  function renderCurrent(current) {
    for (const link of currentRoot.querySelectorAll('a')) { link.removeAttribute('href'); link.textContent = ''; }
    currentRoot.replaceChildren(); currentRoot.hidden = !current;
    if (!current) return;
    const pending = current.status === 'PENDING_PAYMENT';
    currentRoot.append(node('p', pending ? 'ALMOST THERE' : 'YOUR WEEKLY BAKE', 'eyebrow'),
      node('h2', pending ? 'Pay to confirm your subscription' : current.planName),
      node('p', pending ? `${current.planName} · every ${dayName(current.deliveryDay)}` :
        `Active · every ${dayName(current.deliveryDay)} · ${prettyDate(current.startDate)} to ${prettyDate(current.endDate)}`, 'account-state'));
    for (const item of current.items) currentRoot.append(node('p', `${item.quantity} × ${item.name}${item.portion === 'HALF' ? ' (half)' : ''}`));
    const total = node('p', undefined, 'account-total');
    total.append(node('span', `${current.paidWeeks + current.freeWeeks} weeks${current.freeWeeks ? `, ${current.freeWeeks} on us` : ''}`), node('strong', money.format(current.amount)));
    currentRoot.append(total);
    if (current.savings > 0) currentRoot.append(node('p', `About ${money.format(current.savings)} less than ordering the same bakes week by week.`, 'account-note'));
    if (pending) {
      const actions = node('div', undefined, 'account-actions');
      if (current.paymentUrl) {
        const link = node('a', `Pay ${money.format(current.amount)} securely ↗`, 'account-primary');
        link.href = current.paymentUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
        link.addEventListener('click', event => { if (!active()) { event.preventDefault(); controller.load(); } });
        actions.append(link);
      }
      actions.append(action('I’ve paid — check status', () => controller.load()), action('Cancel this request', () => controller.cancel()));
      currentRoot.append(actions, node('p', 'Payment opens in a new tab. Come back here afterwards; this page updates once payment is confirmed. Returning from the payment page alone does not confirm it.', 'account-note'));
      return;
    }
    currentRoot.append(node('h3', 'Deliveries'));
    const list = node('ol', undefined, 'subscribe-deliveries');
    for (const row of current.deliveries) list.append(node('li', `${prettyDate(row.date)} · ${DELIVERY[row.status] || 'In progress'}`));
    currentRoot.append(list);
    if (current.fulfillment) {
      currentRoot.append(node('h3', 'Delivering to'), node('p', current.fulfillment.name), node('p', current.fulfillment.address),
        node('p', `${PREFERENCES[current.fulfillment.deliveryPreference]} · ${PREFERENCES[current.fulfillment.loafPreference]}`));
    }
    const help = node('a', 'Message the bakery to change, pause or skip a week ↗');
    help.href = 'https://wa.me/918796770308?text=Hi%2C%20about%20my%20subscription'; help.target = '_blank'; help.rel = 'noopener noreferrer';
    currentRoot.append(help);
  }
  function render(state) {
    status.textContent = state.message;
    for (const label of doc.querySelectorAll?.('[data-account-label]') || []) label.textContent = state.authenticated ? 'Account' : 'Sign in';
    root.setAttribute('aria-busy', String(state.busy));
    if (state.customer !== shownCustomer) { wipeDetails(); shownCustomer = state.customer; }
    if (!state.plans) { root.hidden = true; renderCurrent(null); builtPlans = null; return; }
    root.hidden = false;
    renderCurrent(state.current);
    form.hidden = !!state.current || state.current === undefined;
    if (!state.plans.plans.length) {
      form.hidden = true;
      if (!state.current && !state.message) status.textContent = 'No subscription plans are open right now. Message the bakery on WhatsApp.';
    }
    if (state.plans !== builtPlans) buildPlans(state.plans);
    loginRoot.hidden = state.authenticated; detailRoot.hidden = !state.authenticated;
    if (state.profile && filledFor !== state.customer) {
      for (const [key, input] of Object.entries(fields)) if (!input.value) input.value = state.profile[key];
      filledFor = state.customer;
    }
    for (const input of [...Object.values(fields), ...form.querySelectorAll('input[type=radio], select')]) input.disabled = state.busy;
    submit.disabled = state.busy || !state.authenticated;
    for (const button of currentRoot.querySelectorAll('button')) button.disabled = state.busy;
    renderSummary();
  }
  submit.addEventListener('click', () => {
    controller.submit({ planCode: selection.plan, option: selection.option, items: [...selection.items], deliveryDay: selection.day,
      ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])) });
  });

  const listen = (target, type, handler) => { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); };
  const recheck = () => { if (active()) controller.load(); };
  const identityChanged = () => { controller.clear('Sign-in changed in another tab. Loading again…'); recheck(); };
  try { channel = new win.BroadcastChannel('tranche.preview.identity'); channel.onmessage = event => { if (event.data === 'identity-changed') identityChanged(); }; }
  catch { /* Focus/visible rechecks remain mandatory when BroadcastChannel is unavailable. */ }
  listen(win, 'offline', () => controller.clear('Offline. Details hidden. Reconnect to continue.'));
  listen(win, 'online', recheck);
  listen(win, 'focus', recheck);
  listen(doc, 'visibilitychange', recheck);
  listen(win, 'pagehide', () => { login?.wipe(); wipeDetails(); controller.clear(); });
  listen(win, 'pageshow', recheck);
  render(controller.state);
  recheck();
  return { controller, destroy() { listeners.forEach(remove => remove()); channel?.close(); login?.wipe(); wipeDetails(); controller.clear(); } };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && checkoutEnabled(window.TRANCHE_STOREFRONT)) {
  const root = document.getElementById('subscribe-app');
  if (root) {
    for (const fallback of document.querySelectorAll('[data-subscribe-fallback]')) fallback.hidden = true;
    attachSubscribe({ root, api: new StorefrontApi(undefined, { checkoutEnabled: true }) });
  }
}
