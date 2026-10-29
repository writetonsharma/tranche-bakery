import { normalizePhone, authFailureMessage } from './phone-model.mjs';

// In-place WhatsApp sign-in. The challenge survives a trip to WhatsApp to read the code; typed values do not survive pagehide.
export function createLogin({ doc, mount, api, notify = () => {}, onVerified }) {
  if (!mount) return null;
  const node = (tag, text, className) => {
    const value = doc.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
  };
  let challenge = null, expires = 0, resendAt = 0, busy = false, resendTimer;
  const form = node('form', undefined, 'account-login-form'); form.autocomplete = 'off';
  const phoneLabel = node('label', 'WhatsApp number', 'account-field');
  const phone = node('input'); phone.type = 'tel'; phone.inputMode = 'tel'; phone.maxLength = 16;
  phone.placeholder = '10-digit mobile number'; phone.autocomplete = 'off'; phoneLabel.append(phone);
  const send = node('button', 'Send WhatsApp code', 'account-primary'); send.type = 'button';
  const codeLabel = node('label', '6-digit code', 'account-field');
  const code = node('input'); code.type = 'text'; code.inputMode = 'numeric'; code.maxLength = 6;
  code.pattern = '[0-9]{6}'; code.autocomplete = 'one-time-code'; codeLabel.append(code);
  const verify = node('button', 'Verify and sign in', 'account-primary'); verify.type = 'submit';
  const note = node('p', '', 'account-note'); note.setAttribute('role', 'status');
  form.append(phoneLabel, send, codeLabel, verify, note);
  mount.replaceChildren(form);
  const update = () => {
    clearTimeout(resendTimer);
    const wait = resendAt - Date.now();
    send.disabled = busy || wait > 0;
    send.textContent = wait > 0 ? 'Code sent' : challenge ? 'Send a new code' : 'Send WhatsApp code';
    if (wait > 0) resendTimer = setTimeout(update, wait);
    codeLabel.hidden = verify.hidden = !challenge;
    verify.disabled = busy;
  };
  send.addEventListener('click', async () => {
    if (busy || Date.now() < resendAt) return;
    const value = normalizePhone(phone.value);
    if (!value) { note.textContent = 'Enter a 10-digit mobile number, or an international number with country code.'; phone.focus?.(); return; }
    busy = true; resendAt = Date.now() + 60000; note.textContent = 'Sending your code…'; update();
    try {
      api.useSession(await api.request('/api/session'));
      const sentAt = Date.now();
      const result = await api.request('/api/auth/challenge', { phone: value });
      if (typeof result?.challengeId !== 'string' || !result.challengeId || result.challengeId.length > 64 ||
          !Number.isInteger(result.expiresInSeconds) || result.expiresInSeconds < 1 || result.expiresInSeconds > 300) throw new Error('Invalid challenge');
      challenge = result.challengeId; expires = sentAt + result.expiresInSeconds * 1000;
      phone.value = ''; code.value = '';
      note.textContent = 'If this number can receive it, your WhatsApp code will arrive shortly. Enter it below.';
    } catch (error) { note.textContent = authFailureMessage(error, 'send'); }
    finally { busy = false; update(); if (challenge) code.focus?.(); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !challenge) return;
    if (Date.now() >= expires) { challenge = null; code.value = ''; note.textContent = 'Code expired. Send a new code.'; update(); return; }
    const value = code.value.trim();
    if (!/^\d{6}$/.test(value)) { note.textContent = 'Enter the 6-digit code from WhatsApp.'; code.focus?.(); return; }
    busy = true; code.value = ''; note.textContent = 'Checking your code…'; update();
    try {
      notify('identity-changed');
      // Returning from WhatsApp rechecks the session, which drops the CSRF token: always bootstrap first.
      api.useSession(await api.request('/api/session'));
      const view = api.useSession(await api.request('/api/auth/verify', { challengeId: challenge, code: value }));
      if (!view.authenticated) throw new Error('Not verified');
      challenge = null; resendAt = 0; note.textContent = '';
    } catch (error) { note.textContent = authFailureMessage(error, 'verify'); }
    finally { busy = false; update(); notify('identity-changed'); }
    if (!challenge && !note.textContent) await onVerified();
  });
  update();
  return { wipe() { phone.value = ''; code.value = ''; } };
}
