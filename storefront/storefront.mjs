import { catalogBindings, readBasket, saveBasket, LatestRequest, STORAGE_KEY } from './model.mjs';
import { validateShopping, additionProblem, basketReadiness, fitsDate, estimatePaise, ESTIMATE_WARNING } from './shopping-model.mjs';
import { StorefrontApi } from './api.mjs';
import { createDrawer, element, quantityControl, renderQuote } from './view.mjs';
import { checkoutEnabled } from './checkout-model.mjs';
import { attachCheckout } from './checkout-view.mjs';
import { GuestIntent } from './guest-intent.mjs';
import { normalizePhone } from './phone-model.mjs';

// Disabled means no fetch, storage access, DOM enhancement, or event listeners.
if (window.TRANCHE_STOREFRONT?.enabled === true && typeof HTMLDialogElement !== 'undefined') {
  const launch = () => {
    if (document.hidden || navigator.onLine === false) return;
    document.removeEventListener('visibilitychange', launch);
    window.removeEventListener('online', launch);
    start().then(started => {
      if (started === false) {
        document.addEventListener('visibilitychange', launch);
        window.addEventListener('online', launch);
        launch();
      }
    }).catch(() => {
      const note = element('p', 'Basket unavailable. Please order on WhatsApp.', 'sf-start-error');
      document.querySelector('.products-intro-copy')?.append(note);
    });
  };
  document.addEventListener('visibilitychange', launch);
  window.addEventListener('online', launch);
  launch();
}

async function start() {
  const checkoutOn = checkoutEnabled(window.TRANCHE_STOREFRONT);
  const api = new StorefrontApi(undefined, { checkoutEnabled: checkoutOn });
  const startup = new AbortController();
  const stopStartup = () => { if (document.hidden || navigator.onLine === false) startup.abort(); };
  document.addEventListener('visibilitychange', stopStartup);
  window.addEventListener('offline', stopStartup);
  let catalog, session, shopping;
  try {
    const [menu, bootstrap] = await Promise.all([
      api.request('/api/catalog', undefined, startup.signal), api.request('/api/session', undefined, startup.signal)
    ]);
    if (startup.signal.aborted || document.hidden || navigator.onLine === false) return false;
    catalog = menu; session = api.useSession(bootstrap);
    const result = await api.request('/api/shopping', {}, startup.signal);
    if (startup.signal.aborted || document.hidden || navigator.onLine === false) return false;
    shopping = validateShopping(result);
  } catch (error) {
    if (startup.signal.aborted) return false;
    throw error;
  } finally {
    document.removeEventListener('visibilitychange', stopStartup);
    window.removeEventListener('offline', stopStartup);
  }
  let prices = new Map(shopping.items.map(item => [item.id, item]));
  let snapshotUsable = true;
  let offlineInvalid = false;
  let shoppingPending = false;
  let shoppingFailed = false;
  document.querySelector('.products-intro-copy')?.append(
    element('p', 'Estimated prices. Final total shown before payment.', 'sf-note sf-price-note'));
  const cards = [...document.querySelectorAll('.product .text > h3')];
  const bindings = catalogBindings(catalog, cards.map(h3 => h3.textContent.trim()));
  const allowedIds = new Set([...bindings.values()].map(item => item.id));
  let storage;
  try { storage = window.localStorage; } catch { /* Private/blocked storage: memory only. */ }
  const restored = readBasket(storage, allowedIds);
  const guestIntent = new GuestIntent(storage);
  let lines = restored.lines;
  let storageWarning = restored.warning;
  let date = '';
  let busy = false;
  let challenge;
  let expires = 0;
  let resendAt = 0;
  let authEpoch = 0;
  let authController;
  let resumeTimer;
  let resumingSession;
  const sessionChecks = new LatestRequest();
  const latest = new LatestRequest();
  const ui = createDrawer();
  const checkout = checkoutOn ? attachCheckout({ api, ui, allowedIds, guestIntent,
    getBasket: () => ({ lines, date }),
    getShopping: () => shopping,
    getReadiness: () => shoppingPending ? 'Checking availability…' : basketReadiness(snapshotUsable ? shopping : null, { lines, date }),
    onActivity: () => invalidate('Checking your order…'),
    onIdentityLost: () => identityUncertain(),
    onAssociate: () => {
      storageWarning = '';
    },
    onBasket: basket => {
      lines = basket.lines; date = basket.date;
      invalidate('Basket updated.'); renderBasket();
    }
  }) : null;
  const controls = [];
  const drawerRows = new Map();
  const authStatus = element('p', '', 'sf-note');
  authStatus.id = 'sf-auth-status';
  authStatus.setAttribute('role', 'status');
  ui.auth.append(authStatus);
  let channel;
  try { channel = new BroadcastChannel('tranche.preview.identity'); } catch { /* Focus also revalidates. */ }

  for (const h3 of cards) {
    const item = bindings.get(h3.textContent.trim());
    if (!item) continue; // Unknown, duplicate or absent/retired: never orderable.
    const wrapper = element('div', undefined, 'sf-card-action');
    wrapper.dataset.sfItem = String(item.id);
    const label = element('span', 'Add to basket', 'sf-card-label');
    const control = quantityControl(item, change);
    wrapper.append(label, control.root);
    h3.parentElement.append(wrapper);
    let price = h3.parentElement.querySelector('.product-price-group');
    if (!price) { price = element('p', 'Public prices are shown in product details.', 'sf-card-price'); wrapper.prepend(price); }
    const publicPrice = [...price.childNodes].map(node => node.cloneNode(true));
    const availability = element('p', '', 'sf-note sf-availability');
    availability.setAttribute('role', 'status');
    wrapper.append(availability);
    controls.push({ id: item.id, ...control, price, publicPrice, availability });
  }
  // The basket is now the way to order; static WhatsApp ordering links remain only
  // as the no-JS/disabled fallback. Turn them into a secondary "questions" link.
  const contact = document.querySelector('.nav-contact[href^="https://wa.me/"]')?.getAttribute('href');
  for (const link of document.querySelectorAll('.product .details a.btn[href^="https://wa.me/"]')) {
    link.textContent = 'Questions? Chat on WhatsApp';
    link.classList.add('btn-secondary');
    if (contact) link.setAttribute('href', contact);
  }
  const ctaLink = document.querySelector('.cta > a.btn[href^="https://wa.me/"]');
  if (ctaLink) {
    const intro = ctaLink.parentElement.querySelector('p');
    if (intro) intro.textContent = 'Add bakes to your basket and order by 5 PM for most next-morning deliveries.';
    const actions = element('div', undefined, 'hero-actions');
    const open = element('button', 'Open basket', 'btn'); open.type = 'button';
    open.addEventListener('click', () => ui.opener.click());
    ctaLink.replaceWith(actions);
    ctaLink.textContent = 'Questions? Chat on WhatsApp';
    ctaLink.classList.add('btn-secondary');
    if (contact) ctaLink.setAttribute('href', contact);
    actions.append(open, ctaLink);
  }

  function invalidate(message = '') {
    ui.status.textContent = message;
  }

  const dayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const formatPrice = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
  function dayLabel(value) { return dayFormat.format(new Date(`${value}T00:00:00Z`)).replace(',', ''); }

  function unavailableReason(id) {
    // Name the mornings a bake can come instead of a generic refusal. Never expose capacity numbers.
    const open = shopping.dates.filter(day => day.maxItems > 0 && day.itemIds.includes(id)).map(day => dayLabel(day.date));
    if (date && shopping.dates.find(day => day.date === date)?.itemIds.includes(id)) return '';
    if (!date && open.length) return '';
    if (!open.length) return 'Not available in the next few days. Contact the bakery to ask.';
    return `Not available on ${dayLabel(date)}. Available ${open.slice(0, 3).join(', ')}${open.length > 3 ? '…' : ''}.`;
  }

  function renderDates() {
    ui.date.replaceChildren();
    const placeholder = element('option', 'Choose a date'); placeholder.value = ''; ui.date.append(placeholder);
    for (const day of shopping?.dates || []) {
      const available = snapshotUsable && fitsDate(shopping, day.date, lines);
      const option = element('option', `${dayLabel(day.date)}${available ? '' : ' — not available for this basket'}`);
      option.value = day.date; option.disabled = !available; ui.date.append(option);
    }
    if (date && ![...ui.date.options].some(option => option.value === date)) {
      const option = element('option', `${dayLabel(date)} — no longer available; choose another date`);
      option.value = date; option.disabled = true; ui.date.append(option);
    }
    ui.date.value = date;
  }

  function renderEstimate() {
    const paise = snapshotUsable ? estimatePaise(lines, prices) : null;
    const text = paise === null ? 'Estimated subtotal unavailable. Check availability again.' :
      `Estimated subtotal: ${formatPrice(paise / 100)}`;
    if (ui.totals.dataset.estimate === text) return;
    ui.totals.dataset.estimate = text;
    ui.totals.replaceChildren(element('h3', text),
      element('p', 'Plus ₹65 delivery, unless an offer makes it free.', 'sf-note sf-delivery-note'),
      element('p', ESTIMATE_WARNING, 'sf-note'));
  }

  function renderBasket() {
    for (const control of controls) {
      control.update(lines.find(line => line.itemId === control.id)?.quantity || 0);
      const item = snapshotUsable ? prices.get(control.id) : null;
      const priceKey = item ? JSON.stringify([item.unitPrice, item.priceLabel]) : 'public';
      if (control.price.dataset.shoppingPrice !== priceKey) {
        control.price.dataset.shoppingPrice = priceKey;
        if (item) control.price.textContent = `${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(item.unitPrice)}${item.priceLabel ? ` · ${item.priceLabel}` : ''}`;
        else control.price.replaceChildren(...control.publicPrice.map(node => node.cloneNode(true)));
      }
      control.availability.textContent = !snapshotUsable ? 'Availability needs rechecking. Basket kept.' : unavailableReason(control.id);
    }
    const count = lines.reduce((sum, line) => sum + line.quantity, 0); // Quantity only, never money.
    ui.opener.textContent = `Basket · ${count}`;
    ui.opener.setAttribute('aria-label', `Open basket, ${count} ${count === 1 ? 'item' : 'items'}`);
    ui.refresh.hidden = snapshotUsable && !shoppingFailed;
    for (const [id, row] of drawerRows) {
      if (!lines.some(line => line.itemId === id)) {
        if (row.root.contains(document.activeElement)) (ui.refresh.hidden ? ui.date : ui.refresh).focus();
        row.root.remove();
        drawerRows.delete(id);
      }
    }
    ui.items.querySelector('.sf-empty')?.remove();
    for (const line of lines) {
      let row = drawerRows.get(line.itemId);
      if (!row) {
        const item = [...bindings.values()].find(item => item.id === line.itemId) || { id: line.itemId, name: 'Unavailable saved bake (reduce to remove)' };
        const root = element('div', undefined, 'sf-line');
        root.dataset.sfItem = String(item.id);
        const control = quantityControl(item, change);
        const each = element('p', '', 'sf-note sf-line-price');
        root.append(element('h3', item.name), each, control.root);
        row = { ...control, root, each };
        drawerRows.set(item.id, row);
        ui.items.append(root);
      }
      row.update(line.quantity);
      const price = snapshotUsable ? prices.get(line.itemId) : null;
      row.each.textContent = price ? `${formatPrice(price.unitPrice)} each` : '';
    }
    if (!lines.length) ui.items.append(element('p', 'Your basket is a blank canvas. Add a bake to begin.', 'sf-empty'));
    renderDates(); renderEstimate(); checkout?.availabilityChanged();
    const problem = basketReadiness(snapshotUsable ? shopping : null, { lines, date });
    if (storageWarning) ui.status.textContent = [storageWarning, problem].filter(Boolean).join(' ');
    else if (problem) ui.status.textContent = problem;
  }

  function persist() {
    if (session?.authenticated || checkout?.hasIdentity || checkout?.accountOwned) return;
    if (guestIntent.retaining || guestIntent.uncertain()) {
      storageWarning = 'An earlier save may have succeeded. Original device additions remain stored. Current edits last only on this page; reloading loses them. Sign in and check your basket before discarding stored additions.';
      return;
    }
    storageWarning = saveBasket(storage, lines, allowedIds) ? '' : 'Basket not saved on this device. Reloading will lose it.';
  }

  function canEditBasket(id) {
    if (!checkout || checkout.canEdit) return true;
    const message = 'Your basket has not changed. Check your current order in Basket before ordering or paying again.';
    // Product controls live outside the closed drawer: feedback there alone is
    // invisible. Open recovery, and retain an inline live notice even if another
    // site modal prevents the native drawer from opening.
    ui.opener.click();
    ui.status.textContent = message;
    const wrapper = controls.find(control => control.id === id)?.root.parentElement;
    if (wrapper) {
      let note = wrapper.querySelector('.sf-edit-note');
      if (!note) {
        note = element('p', '', 'sf-note sf-edit-note'); note.setAttribute('role', 'status'); wrapper.append(note);
      }
      note.textContent = message;
    }
    return false;
  }

  function change(id, delta) {
    if (!canEditBasket(id)) return;
    for (const control of controls) control.root.parentElement.querySelector('.sf-edit-note')?.remove();
    const problem = delta > 0 ? (!allowedIds.has(id) ? 'Basket unchanged. This saved bake is unavailable; reduce it to remove or contact the bakery.' :
      additionProblem(snapshotUsable ? shopping : null, { lines, date }, id)) : '';
    if (problem) {
      ui.status.textContent = problem;
      for (const root of [controls.find(control => control.id === id)?.root.parentElement, drawerRows.get(id)?.root].filter(Boolean)) {
        let note = root.querySelector('.sf-edit-note');
        if (!note) { note = element('p', '', 'sf-note sf-edit-note'); note.setAttribute('role', 'status'); root.append(note); }
        note.textContent = problem;
      }
      return;
    }
    const next = lines.map(line => ({ ...line }));
    const row = next.find(line => line.itemId === id);
    if (row) row.quantity += delta;
    else if (delta > 0) next.push({ itemId: id, quantity: 1 });
    lines = next.filter(line => line.quantity > 0);
    checkout?.changed();
    persist();
    invalidate(storageWarning || '');
    renderBasket();
  }

  function applySession(view) {
    const changed = !session || session.authenticated !== view.authenticated || session.customer?.id !== view.customer?.id;
    if (changed) {
      challenge = undefined;
      ui.phone.value = '';
      ui.otp.value = '';
      latest.invalidate();
      shopping = null; prices = new Map(); snapshotUsable = false;
    }
    session = api.useSession(view);
    checkout?.identity(session.authenticated ? session.customer.id : null);
    renderAuth();
    if (changed || !shopping) { renderBasket(); return refreshShopping(true); }
  }

  async function refreshShopping(unscoped = false) {
    if (document.hidden || navigator.onLine === false) return;
    const ticket = latest.begin();
    const requestedDate = unscoped ? null : date || null;
    shoppingPending = true; renderBasket();
    try {
      const result = validateShopping(await api.request('/api/shopping', requestedDate ? { date: requestedDate } : {}, ticket.signal), requestedDate);
      if (!latest.current(ticket) || document.hidden || navigator.onLine === false) return;
      shopping = result;
      // Scoped responses omit ineligible products. Keep the unscoped active
      // catalogue's prices; eligibility comes from every date's independent IDs.
      if (!requestedDate) prices = new Map();
      for (const item of result.items) if (allowedIds.has(item.id)) prices.set(item.id, item);
      snapshotUsable = true; offlineInvalid = false; shoppingPending = false; shoppingFailed = false;
      invalidate(storageWarning || '');
      renderBasket();
      if (session?.authenticated) scheduleResume();
    } catch (error) {
      if (!latest.current(ticket)) return;
      if ([401, 403].includes(error.status)) {
        api.clearSession();
        session = null;
        checkout?.identity(null);
        shopping = null; prices = new Map();
        renderAuth();
      }
      snapshotUsable = false; shoppingPending = false; shoppingFailed = true; renderBasket();
      invalidate('Availability unavailable. Basket kept; refresh availability or contact the bakery.');
    }
  }

  function scheduleResume() {
    clearTimeout(resumeTimer);
    if (!busy && !ui.opening && !ui.closing && !document.hidden && navigator.onLine !== false) resumeTimer = setTimeout(recheckSession, 200);
  }

  async function recheckSession() {
    if (resumingSession) return resumingSession;
    if (busy || document.hidden || navigator.onLine === false || ui.opening || ui.closing) return;
    const epoch = authEpoch;
    const ticket = sessionChecks.begin();
    const task = (async () => {
      try {
        const view = await api.request('/api/session', undefined, ticket.signal);
        if (epoch !== authEpoch || !sessionChecks.current(ticket) || busy || document.hidden || navigator.onLine === false) return;
        await applySession(view);
        if (epoch !== authEpoch || document.hidden || navigator.onLine === false) return;
        snapshotUsable = Boolean(shopping) && !offlineInvalid && !shoppingFailed;
        renderBasket();
        // Recovery owns its own coalescing/epoch. Never let a slow order GET
        // prevent a newer focus session check from revoking that identity.
        resumingSession = null;
        await checkout?.resume();
      } catch { if (epoch === authEpoch && sessionChecks.current(ticket)) identityUncertain(true); }
    })();
    resumingSession = task;
    try { await task; } finally { if (resumingSession === task) resumingSession = null; }
  }

  function renderAuth() {
    const loggedIn = session?.authenticated === true;
    for (const label of document.querySelectorAll('[data-account-label]')) label.textContent = loggedIn ? 'Account' : 'Sign in';
    ui.identity.textContent = loggedIn ? 'WhatsApp verified.' :
      (session ? '' : 'Please refresh to check your sign-in.');
    ui.form.hidden = loggedIn;
    ui.logout.hidden = !loggedIn;
    ui.auth.setAttribute('aria-busy', String(busy));
    ui.phone.disabled = busy;
    ui.send.disabled = busy || loggedIn || Date.now() < resendAt;
    ui.otp.disabled = busy || !challenge || Date.now() >= expires;
    ui.verify.disabled = busy || !challenge || Date.now() >= expires || !/^\d{6}$/.test(ui.otp.value);
    ui.logout.disabled = busy;
    ui.refresh.disabled = busy;
    ui.date.disabled = busy;
    const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    ui.send.textContent = remaining ? `Resend available in ${remaining}s` : (challenge ? 'Resend WhatsApp code' : 'Send WhatsApp code');
  }

  async function authAction(action) {
    if (busy || document.hidden || !navigator.onLine) {
      if (!navigator.onLine) authStatus.textContent = 'Verification unavailable while offline.';
      return;
    }
    authEpoch += 1;
    sessionChecks.invalidate(); resumingSession = null; clearTimeout(resumeTimer);
    busy = true;
    checkout?.suspend('authentication');
    latest.invalidate(); snapshotUsable = false; shoppingPending = false;
    renderBasket();
    const epoch = authEpoch;
    const controller = new AbortController(); authController = controller;
    const checkCurrent = () => {
      if (epoch !== authEpoch || controller.signal.aborted || document.hidden || !navigator.onLine) throw new Error('Identity changed');
    };
    invalidate('Checking your sign-in…');
    authStatus.textContent = 'Please wait…';
    renderAuth();
    try {
      // Always get a current bootstrap. Unsafe operations are NEVER auto-retried.
      const view = await api.request('/api/session', undefined, controller.signal);
      checkCurrent();
      await applySession(view);
      await action(checkCurrent, controller.signal);
      checkCurrent();
    } catch {
      if (epoch !== authEpoch || controller.signal.aborted) return;
      api.clearSession();
      session = null;
      checkout?.suspend('authentication uncertain');
      latest.invalidate(); shopping = null; prices = new Map(); snapshotUsable = false; renderBasket();
      challenge = undefined;
      ui.otp.value = '';
      authStatus.textContent = 'Verification unavailable or invalid. Please try again later.';
    } finally {
      if (epoch === authEpoch) {
        authController = undefined; busy = false;
        snapshotUsable = Boolean(shopping) && !offlineInvalid && !shoppingFailed;
        renderBasket();
        renderAuth();
        if (challenge && ui.dialog.open && !document.hidden) ui.otp.focus();
        invalidate();
        if (session?.authenticated && !document.hidden && navigator.onLine) scheduleResume();
      }
    }
  }

  function pauseAuth() {
    sessionChecks.invalidate(); resumingSession = null; clearTimeout(resumeTimer);
    authEpoch += 1; authController?.abort(); authController = undefined; busy = false;
    ui.phone.value = ''; ui.otp.value = '';
    renderAuth();
  }

  ui.send.addEventListener('click', () => {
    if (ui.send.disabled) return;
    const phone = normalizePhone(ui.phone.value);
    if (!phone) {
      authStatus.textContent = 'Enter a 10-digit mobile number, or an international number with country code.';
      ui.phone.focus();
      return;
    }
    resendAt = Date.now() + 60000; // Also throttle failures/uncertain delivery locally.
    challenge = undefined;
    ui.otp.value = '';
    authAction(async (checkCurrent, signal) => {
      const sentAt = Date.now();
      checkCurrent();
      const result = await api.request('/api/auth/challenge', { phone }, signal);
      checkCurrent();
      if (typeof result.challengeId !== 'string' || !result.challengeId || result.challengeId.length > 64 ||
          !Number.isInteger(result.expiresInSeconds) || result.expiresInSeconds < 1 || result.expiresInSeconds > 300) {
        throw new Error('Invalid challenge');
      }
      challenge = result.challengeId;
      expires = sentAt + result.expiresInSeconds * 1000;
      ui.phone.value = '';
      authStatus.textContent = 'If available, your WhatsApp code will arrive shortly.';
    });
  });

  ui.form.addEventListener('submit', event => {
    event.preventDefault();
    if (ui.verify.disabled || busy || !challenge || Date.now() >= expires) return;
    const input = { challengeId: challenge, code: ui.otp.value };
    ui.otp.value = '';
    authAction(async (checkCurrent, signal) => {
      checkCurrent();
      channel?.postMessage('identity-changed');
      try {
        const view = await api.request('/api/auth/verify', input, signal);
        checkCurrent();
        await applySession(view); // Includes replacement CSRF, not a cookie read.
        challenge = undefined;
        authStatus.textContent = 'WhatsApp verified.';
        ui.phone.value = '';
      } finally { channel?.postMessage('identity-changed'); }
    });
  });
  ui.logout.addEventListener('click', () => authAction(async (checkCurrent, signal) => {
    checkCurrent();
    channel?.postMessage('identity-changed');
    try {
      const view = await api.request('/api/auth/logout', undefined, signal);
      checkCurrent();
      await applySession(view);
      challenge = undefined;
      ui.phone.value = '';
      ui.otp.value = '';
      authStatus.textContent = 'Logged out.';
    } finally { channel?.postMessage('identity-changed'); }
  }));
  ui.otp.addEventListener('input', renderAuth);
  ui.date.addEventListener('change', () => {
    if (!canEditBasket()) { ui.date.value = date; return; }
    const next = ui.date.value;
    if (next === date) return;
    if (next && (!snapshotUsable || !fitsDate(shopping, next, lines))) {
      ui.date.value = date;
      invalidate('Date unchanged. Unavailable for your whole basket; reduce the basket or contact the bakery for a bulk order.');
      return;
    }
    date = next; checkout?.changed(); invalidate(); renderBasket(); refreshShopping();
  });
  ui.refresh.addEventListener('click', async () => {
    await recheckSession();
    if (!busy && !document.hidden && navigator.onLine !== false) await refreshShopping();
  });
  ui.dialog.addEventListener('sf-opening', () => {
    clearTimeout(resumeTimer);
    checkout?.suspend('drawer opening');
  });
  ui.dialog.addEventListener('sf-open', () => { clearTimeout(resumeTimer); renderAuth(); recheckSession(); });
  ui.dialog.addEventListener('close', () => {
    checkout?.suspend('drawer closed');
    pauseAuth();
    challenge = undefined;
    invalidate();
    authStatus.textContent = '';
    renderAuth();
  });
  ui.dialog.addEventListener('sf-abort', () => { checkout?.suspend('drawer closing'); invalidate(); });

  function identityUncertain(retainAttempt = false) {
    // Uncertainty is not a verified logout. Keep basket ownership and any
    // original ambiguous attempt, but synchronously remove all private UI.
    checkout?.suspend(retainAttempt ? 'offline' : 'identity uncertain');
    pauseAuth();
    api.clearSession();
    latest.invalidate(); snapshotUsable = false; shoppingPending = false;
    if (!retainAttempt) { shopping = null; prices = new Map(); }
    challenge = undefined;
    ui.phone.value = '';
    ui.otp.value = '';
    renderBasket();
    invalidate('Please refresh to check your sign-in. Basket kept.');
    renderAuth();
  }
  if (channel) channel.onmessage = event => { if (event.data === 'identity-changed') { identityUncertain(); scheduleResume(); } };
  window.addEventListener('offline', () => { offlineInvalid = true; identityUncertain(true); invalidate('Offline. Basket kept; reconnect and refresh availability.'); });
  window.addEventListener('online', () => { invalidate('Back online. Checking your sign-in…'); scheduleResume(); });
  function returnedToPage() {
    // Keep an in-memory challenge when the user visits WhatsApp to read the code.
    // Same identity may revalidate session/payment recovery, not cart/shopping.
    if (!busy && !document.hidden && navigator.onLine) scheduleResume();
  }
  window.addEventListener('focus', returnedToPage);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseAuth(); latest.invalidate(); snapshotUsable = false; shoppingPending = false; checkout?.suspend('page hidden'); renderBasket(); invalidate('Basket kept.'); }
    else returnedToPage();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { identityUncertain(true); scheduleResume(); } });
  // BFCache retains the in-memory ambiguous payload/key. Only actual identity
  // changes may discard it; a page return must never enable a fresh-key retry.
  window.addEventListener('pagehide', () => { identityUncertain(true); });
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (session?.authenticated || checkout?.hasIdentity || checkout?.accountOwned) return;
    const restored = readBasket(storage, allowedIds);
    lines = restored.lines;
    checkout?.changed();
    storageWarning = restored.warning;
    invalidate('Basket changed in another tab. Please refresh.');
    renderBasket();
  });
  setInterval(() => {
    if (challenge && Date.now() >= expires) {
      challenge = undefined;
      ui.otp.value = '';
      authStatus.textContent = 'Code expired. Request a new WhatsApp code.';
    }
    ui.timer.textContent = challenge ? `Code expires in ${Math.max(0, Math.ceil((expires - Date.now()) / 1000))}s.` : '';
    renderAuth();
  }, 1000);
  checkout?.identity(session?.authenticated ? session.customer.id : null);
  renderBasket();
  renderAuth();
  ui.status.textContent = storageWarning || basketReadiness(shopping, { lines, date }) || '';
  if (session?.authenticated && !document.hidden && navigator.onLine) scheduleResume();
  function openSignIn() {
    ui.opener.click();
    if (ui.dialog.open && !session?.authenticated) {
      ui.auth.scrollIntoView?.({ block: 'start' });
      ui.phone.focus();
    }
  }
  for (const entry of document.querySelectorAll('[data-account-entry]')) {
    entry.addEventListener('click', event => {
      // Signed-in customers go to their account; everyone else signs in here and keeps browsing.
      if (session?.authenticated || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      openSignIn();
    });
  }
  if (window.location.hash === '#sf-auth' && !document.hidden) openSignIn();
}