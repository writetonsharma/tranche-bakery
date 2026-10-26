import { element, button, renderQuote } from './view.mjs';
import { CheckoutFlow } from './checkout-flow.mjs';

// Called only behind BOTH strict feature flags. No checkout DOM/listeners otherwise.
export function attachCheckout({ api, ui, allowedIds, getBasket, onBasket, onIdentityLost, onActivity }) {
  const root = element('section', undefined, 'sf-checkout');
  root.id = 'sf-checkout'; root.setAttribute('aria-labelledby', 'sf-checkout-title');
  const title = element('h3', 'Delivery checkout'); title.id = 'sf-checkout-title';
  const help = element('p', 'This is real retail ordering and Razorpay payment, not just a preview. Login first. Preparing reserves nothing. Confirm & Pay creates an order awaiting payment. Only verified server status confirms payment.', 'sf-note');
  const status = element('p', '', 'sf-status'); status.id = 'sf-checkout-status'; status.setAttribute('role', 'status');
  const choices = element('div', undefined, 'sf-checkout-actions');
  const load = button('Load account basket (discard these edits)', () => flow.load()); load.id = 'sf-cart-load';
  const save = button('Save this basket to account (replace account basket)', () => flow.save()); save.id = 'sf-cart-save';
  const prepare = button('Prepare server quote', () => flow.prepare()); prepare.id = 'sf-prepare';
  choices.append(load, save, prepare);
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
  const review = element('button', 'Review fixed quote & delivery details'); review.type = 'submit'; review.id = 'sf-review'; form.append(review);
  const accepted = element('div', undefined, 'sf-checkout-review'); accepted.id = 'sf-accepted-details';
  const confirm = button('Confirm & Pay', () => flow.confirm()); confirm.id = 'sf-confirm-pay';
  const recovery = element('div', undefined, 'sf-checkout-actions');
  const retry = button('Check / retry SAME attempt (not a new order)', () => flow.retry()); retry.id = 'sf-checkout-retry';
  const check = button('Refresh verified payment status', () => flow.check()); check.id = 'sf-checkout-refresh';
  const payment = element('a', 'Open secure Razorpay payment link ↗', 'sf-payment-link'); payment.id = 'sf-payment-link';
  payment.target = '_blank'; payment.rel = 'noopener noreferrer'; payment.referrerPolicy = 'no-referrer';
  const abort = button('Pause checkout / hide private details', () => flow.suspend('paused by you')); abort.id = 'sf-checkout-abort';
  const support = element('p', 'For uncertain payments, credit, zero-payable baskets or review, contact the bakery using the WhatsApp link below. Do not submit another order or pay again. Reloading this page loses the in-memory recovery key; contact support if status cannot be recovered.', 'sf-note');
  recovery.append(retry, check, payment, abort);
  root.append(title, help, status, choices, quoteRoot, form, accepted, confirm, recovery, support);
  ui.auth.after(root);
  document.querySelector('#sf-auth .sf-note').textContent = 'Verify your WhatsApp number for personalised prices and optional delivery checkout. Your basket is never silently merged or saved.';
  document.querySelector('#sf-disclaimer').textContent = 'Browsing and preparing reserve nothing. Optional checkout below creates a real order only when you explicitly Confirm & Pay. WhatsApp ordering remains available.';
  let identity = null;
  let pollTimer;
  let expirationTimer;
  let previouslyPrivate = false;
  const flow = new CheckoutFlow({ api, enabled: true, allowedIds, getBasket, onBasket, onIdentityLost, onActivity, onChange: render });
  const clearFields = () => { name.value = ''; address.value = ''; delivery.value = ''; loaf.value = ''; };
  form.addEventListener('submit', event => {
    event.preventDefault();
    flow.review({ name: name.value, address: address.value, deliveryPreference: delivery.value, loafPreference: loaf.value });
  });
  function render(state) {
    clearTimeout(pollTimer); clearTimeout(expirationTimer);
    identity = flow.identity;
    const active = identity !== null && navigator.onLine && ui.dialog.open && !document.hidden;
    const privateVisible = active && !state.suspended;
    if (!privateVisible || (!state.prepared && previouslyPrivate)) clearFields();
    previouslyPrivate = Boolean(state.prepared);
    status.textContent = !identity ? 'Login to choose an account basket. No automatic saving or merging.' : state.message || 'Choose whether to load your account basket or save this basket. Nothing is merged automatically.';
    root.setAttribute('aria-busy', String(state.busy));
    load.disabled = save.disabled = !active || state.busy || Boolean(state.attempt);
    save.disabled ||= state.needsReload;
    prepare.disabled = !active || state.busy || !state.cart || state.dirty || state.needsReload || Boolean(state.attempt);
    quoteRoot.replaceChildren(); accepted.replaceChildren();
    if (privateVisible && !state.busy && (state.prepared || state.cart) && !state.attempt) {
      const quote = state.prepared?.quote || (!state.dirty ? state.cart?.quote : null);
      if (quote) {
        renderQuote(quoteRoot, quote, state.prepared ? 'prepared' : 'preview');
        if (state.prepared) quoteRoot.append(element('p', `Prepared quote expires: ${state.prepared.expiresAt}. Confirm accepts precisely this quote.`, 'sf-note'));
      }
      if (!quote) for (const problem of state.cart?.problems || []) quoteRoot.append(element('p', problem.message, 'sf-note'));
    }
    form.hidden = !privateVisible || !state.prepared || Boolean(state.review);
    for (const input of [name, address, delivery, loaf, review]) input.disabled = state.busy;
    if (privateVisible && state.review) {
      accepted.append(element('h4', 'Delivery snapshot — fixed on confirmation'));
      for (const [label, value] of [['Name', state.review.name], ['Address', state.review.address],
        ['Delivery', state.review.deliveryPreference], ['Loaf', state.review.loafPreference]]) {
        accepted.append(element('p', `${label}: ${value}`, 'sf-note'));
      }
      accepted.append(button('Edit details / review again', () => { state.review = null; flow.emit(); }));
    }
    if (privateVisible && !state.busy && state.attempt && state.result) {
      renderQuote(quoteRoot, state.attempt.quote, 'accepted');
      accepted.append(element('h4', 'Original checkout delivery — not later basket edits'));
      for (const [label, value] of [['Name', state.attempt.payload.name], ['Address', state.attempt.payload.address],
        ['Delivery', state.attempt.payload.deliveryPreference], ['Loaf', state.attempt.payload.loafPreference]]) {
        accepted.append(element('p', `${label}: ${value}`, 'sf-note'));
      }
    }
    confirm.hidden = !privateVisible || !state.review || Boolean(state.attempt);
    confirm.disabled = state.busy;
    retry.hidden = !active || !state.ambiguous || !state.attempt || Boolean(state.attempt.id);
    retry.disabled = state.busy;
    check.hidden = !active || !state.attempt?.id;
    check.disabled = state.busy;
    payment.hidden = true; payment.removeAttribute('href');
    if (privateVisible && !state.busy && state.result?.paymentUrl) { payment.href = state.result.paymentUrl; payment.hidden = false; }
    abort.hidden = !active || state.suspended || (!state.prepared && !state.attempt);
    // Poll only an already owned opaque ID, at most ten GETs, no hidden-page work.
    if (privateVisible && !state.busy && ['CREATING', 'UNKNOWN'].includes(state.result?.status) && flow.polls < 10) {
      pollTimer = setTimeout(() => { if (ui.dialog.open && !document.hidden && navigator.onLine) flow.poll(); }, 5000);
    }
    const deadline = state.prepared?.expiresAt || (state.result?.status === 'PAYABLE' ? state.result.expiresAt : null);
    if (privateVisible && deadline) expirationTimer = setTimeout(() => flow.suspend('quote or payment deadline reached'), Math.min(2147483647, Math.max(1, Date.parse(deadline) - Date.now())));
  }
  render(flow.state);
  return {
    flow,
    identity(id) { identity = Number.isSafeInteger(id) ? id : null; flow.setIdentity(identity); render(flow.state); },
    changed() { flow.changed(); },
    suspend(reason) { flow.suspend(reason); clearFields(); },
    get engaged() { return Boolean(flow.state.cart || flow.state.attempt || flow.state.prepared); }
  };
}