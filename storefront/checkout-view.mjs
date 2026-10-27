import { element, button, renderQuote } from './view.mjs';
import { CheckoutFlow } from './checkout-flow.mjs';
import { BasketSync } from './basket-sync.mjs';

// Called only behind BOTH strict feature flags. No checkout DOM/listeners otherwise.
export function attachCheckout({ api, ui, allowedIds, getBasket, onBasket, onIdentityLost, onActivity, onAssociate = () => {} }) {
  const root = element('section', undefined, 'sf-checkout');
  root.id = 'sf-checkout'; root.setAttribute('aria-labelledby', 'sf-checkout-title');
  const title = element('h3', 'Delivery checkout'); title.id = 'sf-checkout-title';
  const help = element('p', 'Choose your bakes and date, review delivery details, then Confirm & Pay. Nothing is ordered until you confirm.', 'sf-note');
  const status = element('p', '', 'sf-status'); status.id = 'sf-checkout-status'; status.setAttribute('role', 'status');
  const choices = element('div', undefined, 'sf-checkout-actions');
  const basketStatus = element('p', '', 'sf-note'); basketStatus.setAttribute('role', 'status');
  const load = button('Use account basket / discard device edits', () => sync.choose('account')); load.id = 'sf-cart-load';
  const save = button('Keep device basket / replace account basket', () => sync.choose('device')); save.id = 'sf-cart-save';
  const prepare = button('Review order', () => flow.prepare()); prepare.id = 'sf-prepare';
  choices.append(load, save, prepare);
  const accountLink = element('a', 'My account · delivery defaults & order history', 'sf-account-link'); accountLink.href = 'account.html';
  const quoteRoot = element('div', undefined, 'sf-totals'); quoteRoot.id = 'sf-checkout-quote';
  const form = element('form'); form.id = 'sf-delivery'; form.autocomplete = 'off';
  const field = (label, id, tag = 'input') => {
    const wrapper = element('label', label, 'sf-field'); const input = element(tag); input.id = id;
    wrapper.htmlFor = id; wrapper.append(input); form.append(wrapper); return input;
  };
  const name = field('Delivery name (1–100 characters)', 'sf-delivery-name'); name.maxLength = 100; name.required = true;
  const address = field('Full delivery address, one line (10–2000 characters)', 'sf-delivery-address');
  address.maxLength = 2000; address.minLength = 10; address.required = true;
  const delivery = field('Delivery preference', 'sf-delivery-preference', 'select');
  const loaf = field('Loaf preference', 'sf-loaf-preference', 'select');
  for (const [select, options] of [[delivery, [['', 'Choose delivery preference'], ['GATE', 'Leave at gate'], ['DOOR', 'Leave at door'], ['IN_PERSON', 'Hand to me']]],
    [loaf, [['', 'Choose loaf preference'], ['SLICED', 'Sliced'], ['WHOLE', 'Whole']]]]) {
    for (const [value, text] of options) { const option = element('option', text); option.value = value; select.append(option); }
    select.required = true;
  }
  const review = element('button', 'Review delivery & total'); review.type = 'submit'; review.id = 'sf-review'; form.append(review);
  const accepted = element('div', undefined, 'sf-checkout-review'); accepted.id = 'sf-accepted-details';
  const confirm = button('Confirm & Pay', () => flow.confirm()); confirm.id = 'sf-confirm-pay';
  const recovery = element('div', undefined, 'sf-checkout-actions');
  const retry = button('Recover this payment request', () => flow.retry()); retry.id = 'sf-checkout-retry';
  const check = button('Refresh payment status', () => flow.state.attempt?.id ? flow.check() : flow.resume()); check.id = 'sf-checkout-refresh';
  const newOrder = button('Continue shopping', async () => {
    flow.startNewOrder();
    if (!flow.state.attempt) await flow.resume();
  }); newOrder.id = 'sf-new-order';
  const payment = element('a', 'Open secure Razorpay payment link ↗', 'sf-payment-link'); payment.id = 'sf-payment-link';
  payment.target = '_blank'; payment.rel = 'noopener noreferrer'; payment.referrerPolicy = 'no-referrer';
  const abort = button('Hide delivery details', () => {
    flow.suspend('paused by you'); clearFields(); pendingDefaults = null;
    if (!defaultsApplied && !fieldsTouched) flow.defaultsRead = false;
  }); abort.id = 'sf-checkout-abort';
  const support = element('p', 'If payment is uncertain or needs review, contact the bakery on WhatsApp below before ordering or paying again. You can also view this order in My account.', 'sf-note');
  recovery.append(retry, check, payment, newOrder, abort);
  root.append(title, accountLink, help, status, basketStatus, choices, quoteRoot, form, accepted, confirm, recovery, support);
  ui.auth.after(root);
  document.querySelector('#sf-auth .sf-note').textContent = 'Verify WhatsApp for your account basket, saved defaults and website orders. Account basket edits save automatically after any device/account choice. Nothing is merged.';
  document.querySelector('#sf-disclaimer').textContent = 'Browsing and preparing reserve nothing. Optional checkout below creates a real order only when you explicitly Confirm & Pay. WhatsApp ordering remains available.';
  let identity = null;
  let pollTimer;
  let expirationTimer;
  let fieldsTouched = false;
  let pendingDefaults = null;
  let defaultsApplied = false;
  let quoteKey;
  let reviewKey;
  let resuming;
  let resumeEpoch = 0;
  const pageActive = () => navigator.onLine !== false && !document.hidden;
  const networkActive = () => pageActive() && !ui.opening && !ui.closing;
  const sync = new BasketSync({ api, allowedIds, getBasket, onBasket, onIdentityLost, onAssociate,
    isActive: pageActive, onChange: state => {
      if (flow.state.prepared && state.cart && flow.state.cart?.version !== state.cart.version) flow.suspend('account basket refreshed');
      flow.state.cart = state.cart; flow.state.dirty = state.dirty;
      flow.state.needsReload = state.choice;
      render(flow.state);
    } });
  const flow = new CheckoutFlow({ api, enabled: true, allowedIds, getBasket, onBasket, onIdentityLost, onActivity,
    accountEnabled: true, isActive: networkActive, beforePrepare: () => sync.flush(),
    onDefaults: profile => {
      if (fieldsTouched || !networkActive() || !flow.identity) return;
      pendingDefaults = profile;
    }, onChange: render });
  const clearFields = () => { name.value = ''; address.value = ''; delivery.value = ''; loaf.value = ''; };
  for (const input of [name, address, delivery, loaf]) input.addEventListener('input', () => {
    fieldsTouched = true; flow.state.review = null;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    flow.review({ name: name.value, address: address.value, deliveryPreference: delivery.value, loafPreference: loaf.value });
  });
  function render(state) {
    clearTimeout(pollTimer); clearTimeout(expirationTimer);
    identity = flow.identity;
    const active = identity !== null && navigator.onLine && ui.dialog.open && !document.hidden;
    const privateVisible = active && !state.suspended;
    // A background version refresh invalidates the quote, not the customer's
    // in-progress per-order form. Privacy transitions call clearFields explicitly.
    if (!networkActive() || !identity) clearFields();
    const message = !identity ? 'Sign in to use your account basket and checkout.' :
      `${state.message || 'Checking your account…'}${privateVisible && state.result?.orderNumber ? ` Order ${state.result.orderNumber}.` : ''}`;
    if (status.textContent !== message) status.textContent = message;
    const basketMessage = identity && !state.attempt ? sync.state.message : '';
    if (basketStatus.textContent !== basketMessage) basketStatus.textContent = basketMessage;
    basketStatus.hidden = !basketMessage;
    root.setAttribute('aria-busy', String(state.busy && !state.attempt?.id));
    // Signed-in checkout owns its quote. Never show a second preview above it.
    if (ui.totals) ui.totals.hidden = Boolean(identity);
    if (ui.refresh) ui.refresh.hidden = Boolean(identity);
    load.hidden = save.hidden = !identity || !sync.state.choice || Boolean(state.attempt);
    load.disabled = save.disabled = !active || state.busy || sync.state.busy || Boolean(state.attempt);
    prepare.hidden = !identity || !flow.recoveryReady || Boolean(state.attempt || state.prepared) || sync.state.choice;
    prepare.disabled = !active || state.busy || !flow.recoveryReady || !state.cart || state.needsReload || Boolean(state.attempt);
    const nextQuoteKey = privateVisible && !state.attempt ? JSON.stringify([
      state.prepared?.quote || (!state.dirty ? state.cart?.quote : null),
      state.prepared?.expiresAt, state.cart?.problems]) : '';
    if (quoteKey !== nextQuoteKey) {
      quoteKey = nextQuoteKey; quoteRoot.replaceChildren();
      if (privateVisible && (state.prepared || state.cart) && !state.attempt) {
        const quote = state.prepared?.quote || (!state.dirty ? state.cart?.quote : null);
        if (quote) renderQuote(quoteRoot, quote, state.prepared ? 'prepared' : 'preview');
        if (!quote) for (const problem of state.cart?.problems || []) quoteRoot.append(element('p', problem.message, 'sf-note'));
      }
    }
    form.hidden = !privateVisible || !state.prepared || Boolean(state.review);
    if (!form.hidden && pendingDefaults && !fieldsTouched && !defaultsApplied) {
      name.value = pendingDefaults.name; address.value = pendingDefaults.address;
      delivery.value = pendingDefaults.deliveryPreference; loaf.value = pendingDefaults.loafPreference;
      defaultsApplied = true; pendingDefaults = null;
    }
    for (const input of [name, address, delivery, loaf, review]) input.disabled = state.busy && !state.background;
    const nextReviewKey = privateVisible && !state.attempt && state.review ? JSON.stringify(state.review) : '';
    if (reviewKey !== nextReviewKey) {
      reviewKey = nextReviewKey; accepted.replaceChildren();
      if (privateVisible && !state.attempt && state.review) {
        accepted.append(element('h4', 'Your delivery details'));
        for (const [label, value] of [['Name', state.review.name], ['Address', state.review.address],
          ['Delivery', state.review.deliveryPreference], ['Loaf', state.review.loafPreference]]) {
          accepted.append(element('p', `${label}: ${value}`, 'sf-note'));
        }
        accepted.append(button('Edit delivery details', () => { state.review = null; flow.emit(); }));
      }
    }
    confirm.hidden = !privateVisible || !state.review || Boolean(state.attempt);
    confirm.disabled = state.busy;
    retry.hidden = !active || !state.ambiguous || !state.attempt || Boolean(state.attempt.id);
    retry.disabled = state.busy;
    check.hidden = !active || (!state.attempt?.id && flow.recoveryReady) || ['PAID', 'CANCELLED', 'EXPIRED'].includes(state.result?.status);
    check.disabled = state.busy;
    const url = privateVisible ? state.result?.paymentUrl : null;
    if (url) { if (payment.getAttribute?.('href') !== url) payment.href = url; payment.hidden = false; }
    else { payment.hidden = true; payment.removeAttribute('href'); }
    abort.hidden = !active || state.suspended || !state.prepared;
    support.hidden = !identity || !state.attempt || ['PAID', 'CANCELLED', 'EXPIRED'].includes(state.result?.status);
    // Poll only an already owned opaque ID, at most ten GETs, no hidden-page work.
    newOrder.hidden = !active || !['PAID', 'CANCELLED', 'EXPIRED'].includes(state.result?.status);
    newOrder.disabled = state.busy;
    if (networkActive() && !state.suspended && !state.busy && ['PAYABLE', 'CREATING', 'UNKNOWN'].includes(state.result?.status) && flow.polls < 10) {
      pollTimer = setTimeout(() => { if (networkActive()) flow.poll(); }, 5000);
    }
    const deadline = state.prepared?.expiresAt || (state.result?.status === 'PAYABLE' && state.result.paymentUrl ? state.result.expiresAt : null);
    if (privateVisible && deadline) expirationTimer = setTimeout(() => flow.suspend('quote or payment deadline reached'), Math.min(2147483647, Math.max(1, Date.parse(deadline) - Date.now())));
  }
  render(flow.state);
  return {
    flow,
    identity(id) {
      const next = Number.isSafeInteger(id) ? id : null;
      if (next !== flow.identity) {
        resumeEpoch++; resuming = null;
        clearFields(); fieldsTouched = false; pendingDefaults = null; defaultsApplied = false;
      }
      // Flow must clear the old attempt before account-basket removal notifies the outer UI.
      flow.setIdentity(next); sync.setIdentity(next); render(flow.state);
    },
    async resume() {
      if (!networkActive()) return;
      sync.release();
      if (resuming) return resuming;
      const epoch = resumeEpoch;
      const task = (async () => {
        await flow.resume();
        if (epoch !== resumeEpoch || !flow.identity || !networkActive()) return;
        if (!sync.state.choice && (!sync.state.dirty || !sync.state.associated)) await sync.refresh();
        else sync.schedule();
      })();
      resuming = task;
      try { await task; } finally { if (resuming === task) resuming = null; }
    },
    changed() { flow.changed(); sync.changed(); },
    suspend(reason) {
      resumeEpoch++; resuming = null;
      // Closing the private drawer is not a logout: non-PII basket saves may
      // finish while the document remains visible and online.
      if (['drawer opening', 'drawer closing'].includes(reason)) sync.hold();
      else if (reason === 'drawer closed') sync.release();
      else sync.pause();
      flow.suspend(reason); clearFields(); pendingDefaults = null;
      // Suggestions cleared for privacy may be fetched again, but never applied
      // after the first application or after the customer starts editing.
      if (!defaultsApplied && !fieldsTouched) flow.defaultsRead = false;
    },
    get canEdit() { return flow.canEditBasket; },
    get hasIdentity() { return flow.identity !== null; },
    get accountOwned() { return sync.state.associated; },
    get engaged() { return Boolean(flow.state.cart || flow.state.attempt || flow.state.prepared); }
  };
}