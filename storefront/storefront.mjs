import { catalogBindings, readBasket, saveBasket, changeQuantity, LatestRequest, STORAGE_KEY, validateQuote } from './model.mjs';
import { StorefrontApi } from './api.mjs';
import { createDrawer, element, quantityControl, renderQuote } from './view.mjs';
import { checkoutEnabled } from './checkout-model.mjs';
import { attachCheckout } from './checkout-view.mjs';

// Disabled means no fetch, storage access, DOM enhancement, or event listeners.
if (window.TRANCHE_STOREFRONT?.enabled === true && typeof HTMLDialogElement !== 'undefined') {
  const launch = () => {
    if (document.hidden || navigator.onLine === false) return;
    document.removeEventListener('visibilitychange', launch);
    window.removeEventListener('online', launch);
    start().catch(() => {
      const note = element('p', 'Basket preview is unavailable. Please order on WhatsApp as usual.', 'sf-start-error');
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
  const [catalog, bootstrap] = await Promise.all([
    api.request('/api/catalog'), api.request('/api/session')
  ]);
  let session = api.useSession(bootstrap);
  const cards = [...document.querySelectorAll('.product .text > h3')];
  const bindings = catalogBindings(catalog, cards.map(h3 => h3.textContent.trim()));
  const allowedIds = new Set([...bindings.values()].map(item => item.id));
  let storage;
  try { storage = window.localStorage; } catch { /* Private/blocked storage: memory only. */ }
  const restored = readBasket(storage, allowedIds);
  let lines = restored.lines;
  let storageWarning = restored.warning;
  let date = '';
  let busy = false;
  let challenge;
  let expires = 0;
  let resendAt = 0;
  let authEpoch = 0;
  let authController;
  let quoteTimer;
  let expiryTimer;
  const latest = new LatestRequest();
  const ui = createDrawer();
  const checkout = checkoutOn ? attachCheckout({ api, ui, allowedIds,
    getBasket: () => ({ lines, date }),
    onActivity: () => invalidate('Checkout is checking the account basket. Preview totals cleared.'),
    onIdentityLost: () => identityUncertain(),
    onAssociate: () => {
      try { storage?.removeItem(STORAGE_KEY); } catch { /* Account basket is memory/server only. */ }
      storageWarning = '';
    },
    onBasket: basket => {
      lines = basket.lines; date = basket.date;
      // A readable stale account date is not silently changed to an offered date.
      if (date && ![...ui.date.options].some(option => option.value === date)) {
        const option = element('option', `${date} (account basket; recheck availability)`); option.value = date; ui.date.append(option);
      }
      ui.date.value = date; invalidate('Account basket loaded. Review its server quote below.'); renderBasket();
    }
  }) : null;
  checkout?.identity(session?.authenticated ? session.customer.id : null);
  const controls = [];
  const drawerRows = new Map();
  const authStatus = element('p', '', 'sf-note');
  authStatus.id = 'sf-auth-status';
  authStatus.setAttribute('role', 'status');
  ui.auth.append(authStatus);
  let channel;
  try { channel = new BroadcastChannel('tranche.preview.identity'); } catch { /* Focus also revalidates. */ }

  const placeholder = element('option', 'Choose a date');
  placeholder.value = '';
  ui.date.append(placeholder);
  for (const value of [...new Set(catalog.deliveryDates)]) {
    const option = element('option', value);
    option.value = value;
    ui.date.append(option);
  }

  for (const h3 of cards) {
    const item = bindings.get(h3.textContent.trim());
    if (!item) continue; // Unknown, duplicate or absent/retired: never orderable.
    const wrapper = element('div', undefined, 'sf-card-action');
    wrapper.dataset.sfItem = String(item.id);
    const label = element('span', 'Add to basket preview', 'sf-card-label');
    const control = quantityControl(item, change);
    wrapper.append(label, control.root);
    h3.parentElement.append(wrapper);
    controls.push({ id: item.id, ...control });
  }

  function invalidate(message = 'Preview needs refreshing. No totals are current.') {
    latest.invalidate();
    clearTimeout(quoteTimer);
    clearTimeout(expiryTimer);
    ui.totals.replaceChildren();
    ui.totals.removeAttribute('data-current');
    ui.totals.removeAttribute('aria-busy');
    ui.status.textContent = message;
  }

  function renderBasket() {
    const full = lines.length >= 40;
    for (const control of controls) {
      control.update(lines.find(line => line.itemId === control.id)?.quantity || 0, full);
    }
    const count = lines.reduce((sum, line) => sum + line.quantity, 0); // Quantity only, never money.
    ui.opener.textContent = `Basket preview · ${count}`;
    ui.opener.setAttribute('aria-label', `Open basket preview, ${count} items`);
    for (const [id, row] of drawerRows) {
      if (!lines.some(line => line.itemId === id)) {
        if (row.root.contains(document.activeElement)) ui.refresh.focus();
        row.root.remove();
        drawerRows.delete(id);
      }
    }
    ui.items.querySelector('.sf-empty')?.remove();
    for (const line of lines) {
      let row = drawerRows.get(line.itemId);
      if (!row) {
        const item = [...bindings.values()].find(item => item.id === line.itemId);
        const root = element('div', undefined, 'sf-line');
        root.dataset.sfItem = String(item.id);
        const control = quantityControl(item, change);
        root.append(element('h3', item.name), control.root);
        row = { ...control, root };
        drawerRows.set(item.id, row);
        ui.items.append(root);
      }
      row.update(line.quantity, full);
    }
    if (!lines.length) ui.items.append(element('p', 'Your basket is a blank canvas. Add a bake to begin.', 'sf-empty'));
  }

  function persist() {
    if (session?.authenticated || checkout?.hasIdentity || checkout?.accountOwned) return;
    storageWarning = saveBasket(storage, lines, allowedIds) ? '' : 'Device storage unavailable; this basket lasts only on this page.';
  }

  function canEditBasket(id) {
    if (!checkout || checkout.canEdit) return true;
    const message = 'Your basket has not changed. Check the current order in Basket preview, or contact the bakery before starting another order.';
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
    lines = changeQuantity(lines, id, delta, allowedIds);
    checkout?.changed();
    persist();
    invalidate('Basket updated. Getting a fresh server preview…');
    renderBasket();
    scheduleQuote();
  }

  function applySession(view) {
    if (session && (session.authenticated !== view.authenticated || session.customer?.id !== view.customer?.id)) {
      challenge = undefined;
      ui.phone.value = '';
      ui.otp.value = '';
    }
    session = api.useSession(view);
    checkout?.identity(session.authenticated ? session.customer.id : null);
    renderAuth();
  }

  async function quote() {
    if (busy || ui.opening || ui.closing) return;
    invalidate();
    if (document.hidden) return;
    if (!navigator.onLine) {
      ui.status.textContent = 'You appear offline. Basket kept on this device; no current totals.';
      return;
    }
    const ticket = latest.begin();
    const input = { lines: lines.map(line => ({ ...line })), ...(date ? { date } : {}) };
    const quoteDate = date;
    ui.status.textContent = 'Checking your basket with the bakery…';
    ui.totals.setAttribute('aria-busy', 'true');
    try {
      // Recheck cookie identity before every quote. Never trust a cached customer.
      const view = await api.request('/api/session', undefined, ticket.signal);
      if (!latest.current(ticket) || busy) return;
      applySession(view);
      if (checkout && session?.authenticated) {
        ui.totals.replaceChildren();
        ui.status.textContent = 'Account basket saves automatically. Choose Review order below for a fresh quote; only Confirm & Pay places an order.';
        await checkout.resume();
        return;
      }
      if (!input.lines.length) {
        ui.status.textContent = storageWarning || 'Add a bake to preview server prices.';
        return;
      }
      const result = await api.request('/api/quote', input, ticket.signal);
      if (!latest.current(ticket) || busy) return;
      const checked = validateQuote(result, input.lines, quoteDate);
      renderQuote(ui.totals, checked);
      ui.totals.dataset.current = 'true';
      ui.status.textContent = storageWarning || (checked.valid ? 'Server preview updated. This is not an order.' : 'Check the preview messages below. Nothing is reserved.');
      expiryTimer = setTimeout(() => invalidate('This preview has expired. Refresh to check current prices and availability.'), 60000);
    } catch (error) {
      if (!latest.current(ticket)) return;
      if ([401, 403].includes(error.status)) {
        api.clearSession();
        session = null;
        checkout?.identity(null);
        renderAuth();
      }
      invalidate('Server preview unavailable or basket/date no longer available. No totals are current. Try refreshing or order on WhatsApp.');
    } finally {
      if (latest.current(ticket)) ui.totals.removeAttribute('aria-busy');
    }
  }

  function scheduleQuote() {
    clearTimeout(quoteTimer);
    if (!busy && !ui.opening && !ui.closing) quoteTimer = setTimeout(quote, 200);
  }

  function renderAuth() {
    const loggedIn = session?.authenticated === true;
    ui.identity.textContent = loggedIn ? 'WhatsApp verified. Personalised preview enabled.' :
      (session ? 'You are browsing anonymously.' : 'Login state needs rechecking. Refresh the preview.');
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
    busy = true;
    checkout?.identity(null);
    const epoch = authEpoch;
    const controller = new AbortController(); authController = controller;
    const checkCurrent = () => {
      if (epoch !== authEpoch || controller.signal.aborted || document.hidden || !navigator.onLine) throw new Error('Identity changed');
    };
    invalidate('Login state is changing. Previous totals have been cleared.');
    authStatus.textContent = 'Please wait…';
    renderAuth();
    try {
      // Always get a current bootstrap. Unsafe operations are NEVER auto-retried.
      const view = await api.request('/api/session', undefined, controller.signal);
      checkCurrent();
      applySession(view);
      await action(checkCurrent, controller.signal);
      checkCurrent();
    } catch {
      if (epoch !== authEpoch || controller.signal.aborted) return;
      api.clearSession();
      session = null;
      checkout?.identity(null);
      challenge = undefined;
      ui.otp.value = '';
      authStatus.textContent = 'Verification unavailable or invalid. Please try again later.';
    } finally {
      if (epoch === authEpoch) {
        authController = undefined; busy = false;
        renderAuth();
        if (challenge && ui.dialog.open && !document.hidden) ui.otp.focus();
        invalidate('Previous totals cleared. Refresh the server preview to check current login state and totals.');
        if (session?.authenticated && !document.hidden && navigator.onLine) scheduleQuote();
      }
    }
  }

  function pauseAuth() {
    authEpoch += 1; authController?.abort(); authController = undefined; busy = false;
    ui.phone.value = ''; ui.otp.value = '';
    renderAuth();
  }

  ui.send.addEventListener('click', () => {
    if (ui.send.disabled) return;
    const phone = ui.phone.value.trim();
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
      authStatus.textContent = 'Enter a WhatsApp phone number with country code, using digits and an optional leading +.';
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
      authStatus.textContent = 'If the number can receive WhatsApp verification, a code will arrive shortly.';
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
        applySession(view); // Includes replacement CSRF, not a cookie read.
        challenge = undefined;
        authStatus.textContent = 'WhatsApp verified. Refresh the preview for current totals.';
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
      applySession(view);
      challenge = undefined;
      ui.phone.value = '';
      ui.otp.value = '';
      authStatus.textContent = 'Logged out. Your account basket and private details have been removed from this page.';
    } finally { channel?.postMessage('identity-changed'); }
  }));
  ui.otp.addEventListener('input', renderAuth);
  ui.date.addEventListener('change', () => {
    if (!canEditBasket()) { ui.date.value = date; return; }
    date = ui.date.value; checkout?.changed(); invalidate(); scheduleQuote();
  });
  ui.refresh.addEventListener('click', quote);
  ui.dialog.addEventListener('sf-opening', () => {
    clearTimeout(quoteTimer);
    latest.invalidate();
    checkout?.suspend('drawer opening');
  });
  ui.dialog.addEventListener('sf-open', () => { clearTimeout(quoteTimer); renderAuth(); quote(); });
  ui.dialog.addEventListener('close', () => {
    checkout?.suspend('drawer closed');
    pauseAuth();
    challenge = undefined;
    invalidate('Preview closed. Reopen to get current server totals.');
    authStatus.textContent = '';
    renderAuth();
  });
  ui.dialog.addEventListener('sf-abort', () => { checkout?.suspend('drawer closing'); invalidate(); });

  function identityUncertain(retainAttempt = false) {
    if (retainAttempt) checkout?.suspend('offline');
    else checkout?.identity(null);
    pauseAuth();
    api.clearSession();
    session = null;
    challenge = undefined;
    ui.phone.value = '';
    ui.otp.value = '';
    invalidate('Session may have changed. Refresh the server preview.');
    renderAuth();
  }
  if (channel) channel.onmessage = event => { if (event.data === 'identity-changed') identityUncertain(); };
  window.addEventListener('offline', () => { identityUncertain(true); invalidate('Offline. No current totals; please reconnect and refresh.'); });
  window.addEventListener('online', () => { invalidate('Connection restored. Rechecking your session…'); scheduleQuote(); });
  function returnedToPage() {
    // Keep an in-memory challenge when the user visits WhatsApp to read the code.
    // Re-bootstrap identity before the next quote without destroying that challenge.
    invalidate('Session needs rechecking. Refresh the server preview.');
    if (!busy && !document.hidden && navigator.onLine) scheduleQuote();
  }
  window.addEventListener('focus', returnedToPage);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseAuth(); checkout?.suspend('page hidden'); invalidate('Preview paused. Refresh when you return.'); }
    else returnedToPage();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { identityUncertain(true); scheduleQuote(); } });
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
    invalidate('Device basket changed in another tab. Refresh the preview.');
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
  renderBasket();
  renderAuth();
  ui.status.textContent = storageWarning || 'Device-only basket. Open to get a server preview.';
  if (session?.authenticated && !document.hidden && navigator.onLine) scheduleQuote();
  if (window.location.hash === '#sf-auth' && !document.hidden) {
    ui.opener.click();
    if (ui.dialog.open && !session?.authenticated) ui.phone.focus();
  }
}