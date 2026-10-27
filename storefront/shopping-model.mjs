import { validDate } from './model.mjs';

export const RETAIL_LIMIT = 5;
export const ESTIMATE_WARNING = 'Estimated product subtotal — before batch, delivery, basket promotions and credit; final price at checkout. Single-item public offers and special rates may not jointly win for a mixed basket.';
export const totalItems = lines => lines.reduce((sum, line) => sum + line.quantity, 0);
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
const id = value => Number.isSafeInteger(value) && value > 0;

export function shoppingInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).some(key => key !== 'date') ||
      (Object.hasOwn(value, 'date') && value.date !== null && !validDate(value.date))) throw new Error('Invalid shopping request');
  return Object.hasOwn(value, 'date') ? { date: value.date } : {};
}

export function validateShopping(value, requestedDate = null) {
  if (!value || value.retailLimit !== RETAIL_LIMIT || value.date !== requestedDate ||
      value.pricingMode !== 'SINGLE_ITEM_ESTIMATE' || !Array.isArray(value.items) ||
      !Array.isArray(value.dates) || value.dates.length !== 7) throw new Error('Invalid shopping snapshot');
  const ids = new Set(), dates = new Set();
  const items = value.items.map(item => {
    if (!id(item?.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name ||
        typeof item.category !== 'string' || !amount(item.listPrice) || !amount(item.unitPrice) ||
        !['description', 'weightLabel', 'priceLabel'].every(key => item[key] === null || typeof item[key] === 'string') ||
        !(item.singleItemBatchDiscount === null || amount(item.singleItemBatchDiscount)) ||
        (requestedDate === null && item.singleItemBatchDiscount !== null)) throw new Error('Invalid shopping item');
    ids.add(item.id); return Object.freeze({ ...item });
  });
  const choices = value.dates.map(day => {
    if (!validDate(day?.date) || dates.has(day.date) || !Number.isInteger(day.maxItems) ||
        day.maxItems < 0 || day.maxItems > RETAIL_LIMIT || !Array.isArray(day.itemIds) ||
        !day.itemIds.every(id) || new Set(day.itemIds).size !== day.itemIds.length) throw new Error('Invalid shopping date');
    dates.add(day.date); return Object.freeze({ ...day, itemIds: Object.freeze([...day.itemIds]) });
  });
  if (requestedDate && !dates.has(requestedDate)) throw new Error('Invalid shopping horizon');
  return Object.freeze({ ...value, items: Object.freeze(items), dates: Object.freeze(choices) });
}

export function fitsDate(snapshot, date, lines) {
  const day = snapshot?.dates.find(day => day.date === date);
  return Boolean(day && day.maxItems > 0 && totalItems(lines) <= Math.min(RETAIL_LIMIT, day.maxItems) &&
    lines.every(line => day.itemIds.includes(line.itemId)));
}

export function basketReadiness(snapshot, basket) {
  if (!basket.lines.length) return 'Add a bake to your basket.';
  if (totalItems(basket.lines) > RETAIL_LIMIT) return 'Your basket is kept in full. Reduce it to five items or contact the bakery for a bulk order.';
  if (!snapshot) return 'Availability needs rechecking. Your basket has not changed.';
  if (!basket.date) return 'Choose a delivery date that fits your whole basket. If none fit, reduce the basket or contact the bakery for a bulk order.';
  if (!fitsDate(snapshot, basket.date, basket.lines)) return 'This date is unavailable for your whole basket. Keep your bakes and choose another date, reduce the basket or contact the bakery for a bulk order.';
  return '';
}

export function additionProblem(snapshot, basket, itemId) {
  if (!snapshot) return 'Basket unchanged. Availability needs rechecking; refresh availability or contact the bakery.';
  if (totalItems(basket.lines) >= RETAIL_LIMIT) return 'Basket unchanged. Online baskets are limited to five items total. Reduce your basket or contact the bakery for a bulk order.';
  const lines = basket.lines.map(line => ({ ...line }));
  const line = lines.find(line => line.itemId === itemId);
  if (line) line.quantity++; else lines.push({ itemId, quantity: 1 });
  if (basket.date ? !fitsDate(snapshot, basket.date, lines) : !snapshot.dates.some(day => fitsDate(snapshot, day.date, lines))) {
    return 'Basket unchanged. This bake or quantity is unavailable for your selected date or whole basket. Choose another date, reduce your basket or contact the bakery for a bulk order.';
  }
  return '';
}

// Current anonymous intent, including edits made while GET was pending, merges
// exactly once with saved quantities. Never truncate even a legacy/overflow cart.
export function mergeBaskets(local, saved, snapshot) {
  const quantities = new Map();
  for (const line of [...local.lines, ...saved.lines]) quantities.set(line.itemId, (quantities.get(line.itemId) || 0) + line.quantity);
  const lines = [...quantities].sort(([a], [b]) => a - b).map(([itemId, quantity]) => ({ itemId, quantity }));
  const date = fitsDate(snapshot, local.date, lines) ? local.date : fitsDate(snapshot, saved.date, lines) ? saved.date : '';
  return { lines, date };
}

export function estimatePaise(lines, prices) {
  let total = 0;
  for (const line of lines) {
    const item = prices.get(line.itemId);
    if (!item) return null;
    total += Math.round(item.unitPrice * 100) * line.quantity;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}