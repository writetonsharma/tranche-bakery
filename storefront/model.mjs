export const STORAGE_KEY = 'tranche.preview.lines.v1';
export const MAX_LINES = 40;
export const MAX_QUANTITY = 99;

// Exact current public h3 -> catalogue name contract. No fuzzy matches or aliases.
export const PRODUCT_NAMES = Object.freeze([
  'Classic Table White', '100% Whole Wheat Loaf', 'Multi-Seed Loaf',
  'Milk & Butter Loaf', 'Olive Loaf', 'Caramelized Onion Loaf', 'Honey & Oat Loaf',
  '100% Whole Wheat Rolls', 'Multi-Seed Rolls', 'Sesame Burger Buns',
  'Bavarian Pretzel Buns', 'Classic New York-Style Bagel',
  'Olive, Tomato & Rosemary Focaccia', 'Garlic & Herb Knots', 'Cinnamon Rolls',
  'Chocolate Babka Buns', 'Vanilla Tea Cake', 'Lemon Tea Cake',
  'Dark Chocolate Marble Tea Cake', 'Date & Walnut Tea Cake'
]);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
export const validDate = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function catalogBindings(catalog, headings) {
  if (!Array.isArray(catalog?.items) || !Array.isArray(catalog.deliveryDates) ||
      !catalog.deliveryDates.every(validDate)) throw new Error('Invalid catalogue');
  const names = new Map();
  const ids = new Set();
  for (const item of catalog.items) {
    if (!positiveId(item.id) || typeof item.name !== 'string' || !item.name ||
        names.has(item.name) || ids.has(item.id)) throw new Error('Ambiguous catalogue');
    ids.add(item.id);
    names.set(item.name, Object.freeze({ id: item.id, name: item.name }));
  }
  const counts = new Map();
  for (const name of headings) counts.set(name, (counts.get(name) || 0) + 1);
  return new Map(headings.filter(name => PRODUCT_NAMES.includes(name) && counts.get(name) === 1 &&
    names.has(name)).map(name => [name, names.get(name)]));
}

// Persisted account lines can outlive catalogue membership; structure stays strict.
export function validateLineStructure(value) {
  if (!Array.isArray(value) || value.length > MAX_LINES) throw new Error('Invalid basket');
  const seen = new Set();
  return value.map(line => {
    if (!line || Object.keys(line).sort().join(',') !== 'itemId,quantity' ||
        !positiveId(line.itemId) || seen.has(line.itemId) ||
        !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw new Error('Invalid basket');
    }
    seen.add(line.itemId);
    return { itemId: line.itemId, quantity: line.quantity };
  });
}

export function validateLines(value, allowedIds) {
  const lines = validateLineStructure(value);
  if (lines.some(line => !allowedIds.has(line.itemId))) throw new Error('Invalid basket');
  return lines;
}

export function readBasket(storage, allowedIds) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null && raw.length > 8192) throw new Error('Oversized basket');
    return { lines: raw === null ? [] : validateLines(JSON.parse(raw), allowedIds), warning: '' };
  } catch {
    try { storage.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
    return { lines: [], warning: 'Device basket unavailable or invalid; starting empty.' };
  }
}

export function saveBasket(storage, lines, allowedIds) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(validateLines(lines, allowedIds)));
    return true;
  } catch { return false; }
}

export function changeQuantity(lines, itemId, delta, allowedIds) {
  validateLines(lines, allowedIds);
  if (!allowedIds.has(itemId) || ![-1, 1].includes(delta)) throw new Error('Invalid change');
  const next = lines.map(line => ({ ...line }));
  const index = next.findIndex(line => line.itemId === itemId);
  if (index === -1) {
    if (delta === 1 && next.length < MAX_LINES) next.push({ itemId, quantity: 1 });
  } else {
    next[index].quantity = Math.min(MAX_QUANTITY, next[index].quantity + delta);
    if (!next[index].quantity) next.splice(index, 1);
  }
  return validateLines(next, allowedIds);
}

// Every basket/date/session/offline transition invalidates ALL older quote work.
export class LatestRequest {
  #version = 0;
  #controller;
  invalidate() {
    this.#version += 1;
    this.#controller?.abort();
  }
  begin() {
    this.invalidate();
    this.#controller = new AbortController();
    return { version: this.#version, signal: this.#controller.signal };
  }
  current(ticket) { return ticket.version === this.#version && !ticket.signal.aborted; }
}

export function validateQuote(quote, lines, date) {
  const amounts = ['listSubtotal', 'discountAmount', 'batchDiscountAmount',
    'deliveryCharge', 'creditApplied', 'totalAmount'];
  if (!quote || typeof quote.valid !== 'boolean' || quote.date !== (date || null) ||
      !Array.isArray(quote.problems) || !quote.problems.every(p => typeof p.message === 'string') ||
      !Array.isArray(quote.lines) || quote.lines.length !== lines.length ||
      !amounts.every(key => typeof quote[key] === 'number' && Number.isFinite(quote[key]) && quote[key] >= 0)) {
    throw new Error('Invalid quote');
  }
  const seen = new Set();
  for (const row of quote.lines) {
    const input = lines.find(line => line.itemId === row.itemId);
    if (!input || seen.has(row.itemId) || row.quantity !== input.quantity ||
        typeof row.name !== 'string' || !['unitPrice', 'lineTotal'].every(key =>
          typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0) ||
        !(row.specialUnitPrice == null || (typeof row.specialUnitPrice === 'number' &&
          Number.isFinite(row.specialUnitPrice) && row.specialUnitPrice >= 0))) {
      throw new Error('Invalid quote');
    }
    seen.add(row.itemId);
  }
  return quote;
}

// A special-rate line shows the customer's own price after the struck-through list price.
export function appendQuoteLine(target, line, money, make) {
  const special = typeof line.specialUnitPrice === 'number' ? line.specialUnitPrice : null;
  if (special === null) {
    target.textContent = `${line.name} · ${line.quantity} × ${money.format(line.unitPrice)} · ${money.format(line.lineTotal)}`;
  } else {
    target.append(make('span', `${line.name} · ${line.quantity} × `), make('s', money.format(line.unitPrice)),
      make('span', ` ${money.format(special)} · ${money.format(Math.round(special * 100) * line.quantity / 100)}`));
  }
  return target;
}