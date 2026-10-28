// Keep the existing accepted formats; only bare Indian mobile input gains 91.
export function normalizePhone(value) {
  if (typeof value !== 'string') return null;
  const phone = value.trim();
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) return null;
  return /^\d{10}$/.test(phone) ? `91${phone}` : phone;
}

// The server's auth errors are deliberately generic; only the status tells a mistyped code from a limit.
export function authFailureMessage(error, step) {
  if (error?.status === 429) return 'Too many codes requested. Please wait 15 minutes, then try again.';
  if (step === 'verify' && error?.status === 400) return 'That code did not work. Use the latest code from WhatsApp, or send a new one.';
  if (step === 'send') return 'Could not send a code right now. Please try again in a minute.';
  return 'Sign-in unavailable right now. Please try again shortly.';
}