import { validateLines, validateLineStructure, validateQuote, validDate } from './model.mjs';

// Server currently generates 192-bit base64url attempt IDs. Bounded, not a path.
export const OPAQUE_ID = /^[A-Za-z0-9_-]{32}$(?![\s\S])/;
export const checkoutEnabled = config => config?.enabled === true && config?.checkoutEnabled === true;
export const PROBLEMS = Object.freeze({
  PROFILE_CONFLICT: 'Saved details changed elsewhere. Reload them before saving again.',
  CART_CONFLICT: 'Account basket changed. Your local edits are kept. Retry saving, then review again.',
  RETAIL_LIMIT_EXCEEDED: 'Online baskets are limited to five items total. Reduce your basket or contact the bakery for a bulk order.',
  QUOTE_CHANGED: 'Prices or availability changed. Review your order again.',
  QUOTE_EXPIRED: 'Your total needs refreshing. Review your order again.',
  IDEMPOTENCY_CONFLICT: 'This order needs bakery review. Do not order or pay again.',
  CHECKOUT_IN_PROGRESS: 'An earlier checkout needs payment or support review. Do not create another order.',
  CREDIT_SUPPORT_REQUIRED: 'To use account credit, contact the bakery. It cannot be used online yet.',
  ZERO_PAYABLE_SUPPORT_REQUIRED: 'This basket needs bakery support. A zero total does not confirm payment.',
  PAYMENT_UNAVAILABLE: 'Online payment unavailable. Contact the bakery before paying another way.',
  FULLY_BOOKED: 'This delivery date is fully booked. Choose another date and review again.',
  CHECKOUT_NOT_FOUND: 'Order status unavailable. Contact support before ordering or paying again.',
  INVALID_REQUEST: 'Check quantities, date and delivery details, then try again.',
  EMPTY_CART: 'Add a bake to your basket.', DATE_REQUIRED: 'Choose a delivery date.',
  DATE_UNAVAILABLE: 'Choose an available delivery date.',
  ITEM_UNAVAILABLE: 'A bake is no longer available. Review your basket.'
});
export const problemMessage = code => Object.hasOwn(PROBLEMS, code) ? PROBLEMS[code] :
  'Service unavailable or basket needs attention. Refresh safely or contact the bakery.';
const safeProblems = problems => {
  if (!Array.isArray(problems) || problems.length > 40) throw new Error('Invalid problems');
  return problems.map(p => ({ code: Object.hasOwn(PROBLEMS, p?.code) ? p.code : 'UNAVAILABLE', message: problemMessage(p?.code) }));
};
export function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
export function cartInput(version, basket, ids, now = Date.now()) {
  if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid version');
  const lines = validateLines(basket.lines, ids);
  const date = basket.date || null;
  if (date !== null) {
    const today = new Date(now + 330 * 60000).toISOString().slice(0, 10);
    const end = new Date(Date.parse(today) + 60 * 86400000).toISOString().slice(0, 10);
    if (!validDate(date) || date < today || date > end) throw new Error('Invalid date');
  }
  return { version, lines, date };
}
export function validateCart(value) {
  if (!value || !Number.isSafeInteger(value.version) || value.version < 0 ||
      value.version > Number.MAX_SAFE_INTEGER || (value.date !== null && !validDate(value.date))) throw new Error('Invalid cart');
  // GET describes persisted edits, not today's purchasable catalogue. Never send
  // these lines back without cartInput's separate current-catalogue validation.
  const lines = validateLineStructure(value.lines);
  const problems = safeProblems(value.problems);
  const quote = value.quote === null ? null : cleanQuote(value.quote, lines, value.date);
  return immutable({ version: value.version, lines, date: value.date, quote, problems });
}
function cleanQuote(value, lines, date) {
  const checked = validateQuote(value, lines, date);
  return { ...structuredClone(checked), problems: safeProblems(checked.problems) };
}
export function validatePrepared(value, cart, now = Date.now()) {
  if (!cart || value?.cartVersion !== cart.version || cart.version < 1 ||
      typeof value.quoteToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value.quoteToken) ||
      typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now ||
      Date.parse(value.expiresAt) > now + 10 * 60000 + 30000) throw new Error('Invalid prepared quote');
  const quote = cleanQuote(value.quote, cart.lines, cart.date);
  if (!quote.valid || !cart.date || !cart.lines.length || quote.problems.length) throw new Error('Invalid quote');
  return immutable({ cartVersion: cart.version, quote, quoteToken: value.quoteToken, expiresAt: value.expiresAt });
}
export function fulfillment(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'address,deliveryPreference,loafPreference,name') throw new Error('Invalid details');
  const text = (key, min, max) => {
    if (typeof value[key] !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value[key])) throw new Error('Invalid details');
    const trimmed = value[key].trim();
    if (trimmed.length < min || trimmed.length > max) throw new Error('Invalid details');
    return trimmed;
  };
  if (!['GATE', 'DOOR', 'IN_PERSON'].includes(value.deliveryPreference) || !['SLICED', 'WHOLE'].includes(value.loafPreference)) throw new Error('Invalid preferences');
  return immutable({ name: text('name', 1, 100), address: text('address', 10, 2000),
    deliveryPreference: value.deliveryPreference, loafPreference: value.loafPreference });
}
export function paymentUrl(value) {
  // Reject normalization tricks as well as unsafe hosts. Provider links need no query.
  if (typeof value !== 'string' || value.length > 2048 ||
      /[\u0000-\u0020\u007f-\u009f]/.test(value) ||
      !/^https:\/\/(?:rzp\.io|razorpay\.com)\/[A-Za-z0-9/_-]+$/.test(value) ||
      /\/\//.test(value.slice(8)) || value.endsWith('/')) throw new Error('Invalid payment URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['rzp.io', 'razorpay.com'].includes(url.hostname) ||
      url.username || url.password || url.port || url.hash || url.search || url.pathname === '/') throw new Error('Invalid payment URL');
  return value;
}
export function validateCheckout(value, expectedId, now = Date.now()) {
  if (!value || !OPAQUE_ID.test(value.id) || (expectedId && value.id !== expectedId) ||
      !['CREATING', 'PAYABLE', 'UNKNOWN', 'PAID', 'REVIEW_REQUIRED', 'CANCELLED', 'EXPIRED'].includes(value.status) ||
      typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('Invalid checkout');
  const expired = value.status === 'PAYABLE' && Date.parse(value.expiresAt) <= now;
  return immutable({ id: value.id, status: expired ? 'EXPIRED' : value.status, expiresAt: value.expiresAt,
    paymentUrl: !expired && value.status === 'PAYABLE' && value.paymentUrl != null ? paymentUrl(value.paymentUrl) : null });
}