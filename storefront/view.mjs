const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(text, action, label = text) {
  const node = element('button', text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.addEventListener('click', action);
  return node;
}
export function quantityControl(item, change) {
  const root = element('div', undefined, 'sf-quantity');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `${item.name} preview quantity`);
  const minus = button('−', () => change(item.id, -1), `Remove one ${item.name}`);
  const count = element('span', '0');
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  count.setAttribute('aria-label', `${item.name} quantity`);
  const plus = button('+', () => change(item.id, 1), `Add one ${item.name}`);
  root.append(minus, count, plus);
  return { root, update(quantity, full) {
    minus.disabled = quantity === 0;
    count.textContent = String(quantity);
    plus.disabled = quantity >= 99 || (full && !quantity);
  } };
}

export function createDrawer() {
  const opener = button('Basket preview · 0', open, 'Open basket preview');
  opener.id = 'sf-open';
  opener.className = 'sf-launcher';
  opener.setAttribute('aria-haspopup', 'dialog');
  opener.setAttribute('aria-controls', 'sf-drawer');
  const dialog = element('dialog', undefined, 'sf-dialog');
  dialog.id = 'sf-drawer';
  dialog.setAttribute('aria-labelledby', 'sf-title');
  dialog.setAttribute('aria-describedby', 'sf-disclaimer');
  const panel = element('div', undefined, 'sf-panel');
  const heading = element('div', undefined, 'sf-heading');
  const title = element('h2', 'Your next slow morning');
  title.id = 'sf-title';
  const close = button('×', shut, 'Close basket preview');
  close.id = 'sf-close';
  close.autofocus = true;
  heading.append(title, close);
  const eyebrow = element('p', 'TRANCHÉ / BASKET PREVIEW', 'sf-eyebrow');
  const disclaimer = element('p', 'A little planning, not an order. This preview does not reserve bakes or delivery. Order on WhatsApp as usual.', 'sf-note');
  disclaimer.id = 'sf-disclaimer';
  const status = element('p', '', 'sf-status');
  status.id = 'sf-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const items = element('div', undefined, 'sf-items');
  items.id = 'sf-items';
  const dateLabel = element('label', 'Preview delivery date', 'sf-field');
  const date = element('select');
  date.id = 'sf-date';
  dateLabel.htmlFor = date.id;
  dateLabel.append(date);
  const totals = element('div', undefined, 'sf-totals');
  totals.id = 'sf-totals';
  const refresh = button('Refresh server preview', () => {});
  refresh.id = 'sf-refresh';
  const auth = element('section', undefined, 'sf-auth');
  auth.id = 'sf-auth';
  const authTitle = element('h3', 'WhatsApp login');
  const authHelp = element('p', 'Optional: verify your WhatsApp number for a personalised preview. No checkout is available here.', 'sf-note');
  const identity = element('p');
  identity.id = 'sf-identity';
  const form = element('form');
  form.id = 'sf-login';
  form.autocomplete = 'off';
  const phoneLabel = element('label', 'WhatsApp phone (include country code)', 'sf-field');
  const phone = element('input');
  phone.id = 'sf-phone';
  phone.type = 'tel';
  phone.inputMode = 'tel';
  phone.maxLength = 16;
  phone.placeholder = '+91…';
  phoneLabel.htmlFor = phone.id;
  phoneLabel.append(phone);
  const send = button('Send WhatsApp code', () => {});
  send.id = 'sf-send';
  const otpLabel = element('label', '6-digit code', 'sf-field');
  const otp = element('input');
  otp.id = 'sf-code';
  otp.type = 'text';
  otp.inputMode = 'numeric';
  otp.pattern = '[0-9]{6}';
  otp.maxLength = 6;
  otp.autocomplete = 'off';
  otpLabel.htmlFor = otp.id;
  otpLabel.append(otp);
  const verify = element('button', 'Verify code');
  verify.id = 'sf-verify';
  verify.type = 'submit';
  const timer = element('p', '', 'sf-note');
  timer.id = 'sf-expiry';
  const logout = button('Log out', () => {});
  logout.id = 'sf-logout';
  form.append(phoneLabel, send, otpLabel, timer, verify);
  auth.append(authTitle, authHelp, identity, form, logout);
  const fallback = element('a', 'Continue ordering on WhatsApp ↗', 'sf-fallback');
  fallback.href = 'https://wa.me/918800206057?text=hi';
  fallback.target = '_blank';
  fallback.rel = 'noopener';
  panel.append(eyebrow, heading, disclaimer, status, items, dateLabel, totals, refresh, auth, fallback);
  dialog.append(panel);
  document.body.append(opener, dialog);
  let restoreFocus;
  let closing = false;
  let opening = false;
  let openTimer;
  let closeTimer;
  let generation = 0;
  function open() {
    if (dialog.open || document.body.matches('.nav-open, .modal-open') ||
        document.querySelector('#detail-modal:not([hidden])')) return;
    restoreFocus = document.activeElement;
    const current = ++generation;
    opening = true;
    dialog.showModal(); // Native top-layer focus trap + background inertness.
    document.documentElement.classList.add('sf-lock');
    dialog.dispatchEvent(new Event('sf-opening'));
    // Let the closed transform paint before starting the slide; never force a
    // synchronous layout of the drawer's (potentially large) contents.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (current !== generation || !dialog.open || closing) return;
      dialog.classList.add('sf-visible');
      const ready = () => {
        if (current !== generation || !dialog.open || closing) return;
        opening = false;
        dialog.dispatchEvent(new Event('sf-open'));
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) ready();
      else openTimer = setTimeout(ready, 240);
    }));
  }
  function shut() {
    if (!dialog.open || closing) return;
    generation++; opening = false; clearTimeout(openTimer);
    dialog.dispatchEvent(new Event('sf-abort'));
    closing = true;
    dialog.classList.remove('sf-visible');
    const finish = () => {
      dialog.close();
      document.documentElement.classList.remove('sf-lock');
      closing = false;
      if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else closeTimer = setTimeout(finish, 240);
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); shut(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      shut();
    }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) shut(); });
  dialog.addEventListener('close', () => {
    generation++; opening = false; closing = false;
    clearTimeout(openTimer); clearTimeout(closeTimer);
    dialog.classList.remove('sf-visible');
    document.documentElement.classList.remove('sf-lock');
    phone.value = '';
    otp.value = '';
  });
  return { opener, dialog, status, items, date, totals, refresh,
    auth, identity, form, phone, send, otp, verify, timer, logout,
    get opening() { return opening; }, get closing() { return closing; } };
}

export function renderQuote(root, quote, mode = 'preview') {
  root.replaceChildren();
  const heading = element('h3', mode === 'accepted' ? 'Order total' :
    mode === 'prepared' ? 'Review your order' : quote.valid ? 'Basket total' : 'Basket needs attention');
  root.append(heading);
  for (const line of quote.lines) {
    root.append(element('p', `${line.name} · ${line.quantity} × ${money.format(line.unitPrice)} · ${money.format(line.lineTotal)}`, 'sf-note'));
  }
  for (const [label, key] of [['List subtotal', 'listSubtotal'], ['Discount', 'discountAmount'],
    ['Batch discount', 'batchDiscountAmount'], ['Delivery', 'deliveryCharge'],
    ['Credit applied', 'creditApplied'], [mode === 'preview' ? 'Preview total' : 'Checkout total', 'totalAmount']]) {
    const row = element('p', undefined, key === 'totalAmount' ? 'sf-total' : 'sf-total-row');
    row.append(element('span', label), element('strong', money.format(quote[key])));
    root.append(row);
  }
  for (const key of ['discountLabel', 'batchDiscountLabel', 'giftLabel']) {
    if (typeof quote[key] === 'string' && quote[key]) root.append(element('p', quote[key], 'sf-note'));
  }
  root.append(element('p', `Delivery date: ${quote.date || 'not selected'}`, 'sf-note'));
  for (const problem of quote.problems) root.append(element('p', problem.message, 'sf-note'));
  root.append(element('p', mode === 'accepted' ?
    'This fixed quote belongs to this original checkout attempt, not any later basket edits. Payment is confirmed only by verified server status.' :
    mode === 'prepared' ? 'Check your delivery details and total. Nothing is ordered until Confirm & Pay.' :
    'Preview only. Nothing has been ordered, reserved or charged.', 'sf-note'));
}