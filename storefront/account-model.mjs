import { validateQuote, validateLineStructure, validDate } from './model.mjs';
import { fulfillment, immutable, OPAQUE_ID, paymentUrl, validateCheckout } from './checkout-model.mjs';

const profileKeys = 'address,deliveryPreference,loafPreference,name,version';
const statuses = new Set(['CREATING', 'UNKNOWN', 'PAYABLE', 'PAID', 'REVIEW_REQUIRED', 'CANCELLED', 'EXPIRED']);
const orderStatuses = new Set(['INVOICED', 'PENDING_CONFIRMATION', 'PENDING_PAYMENT_SCREENSHOT',
  'PAYMENT_SCREENSHOT_RECEIVED', 'PAYMENT_SCREENSHOT_VERIFIED', 'PAYMENT_REVIEW_REQUIRED',
  'CONFIRMED', 'IN_BAKING', 'OUT_FOR_DELIVERY', 'CANCELLED', 'COMPLETED']);
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const summaryKeys = 'createdAt,deliveryDate,id,orderNumber,orderStatus,status,totalAmount';
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== keys) throw new Error('Invalid account response');
}
function text(value, min, max) {
  if (typeof value !== 'string' || controls.test(value) || value.trim().length < min ||
      value.trim().length > max) throw new Error('Invalid account text');
  return value.trim();
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) ||
      !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)) ||
      Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) {
    throw new Error('Invalid account timestamp');
  }
  return value;
}
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100;
function metadata(value) {
  if (typeof value.id !== 'string' || !OPAQUE_ID.test(value.id) || !statuses.has(value.status) ||
      !orderStatuses.has(value.orderStatus)) throw new Error('Invalid account order');
  return { id: value.id, orderNumber: text(value.orderNumber, 1, 100),
    createdAt: instant(value.createdAt), orderStatus: value.orderStatus, status: value.status };
}

// GET suggestions are not consent. Only profileInput/explicit PUT uses saving rules.
export function validateProfile(value, { saving = false } = {}) {
  exact(value, profileKeys);
  if (!Number.isSafeInteger(value.version) || value.version < 0 ||
      value.version > Number.MAX_SAFE_INTEGER - (saving ? 1 : 0)) throw new Error('Invalid profile version');
  text(value.name, saving ? 1 : 0, 100);
  text(value.address, saving ? 10 : 0, 2000);
  const details = { name: value.name, address: value.address,
    deliveryPreference: value.deliveryPreference, loafPreference: value.loafPreference };
  if (saving) return immutable({ version: value.version, ...fulfillment(details) });
  if (!['', 'GATE', 'DOOR', 'IN_PERSON'].includes(value.deliveryPreference) ||
      !['', 'SLICED', 'WHOLE'].includes(value.loafPreference)) throw new Error('Invalid profile preferences');
  return immutable({ version: value.version, name: value.name.trim(), address: value.address.trim(),
    deliveryPreference: value.deliveryPreference, loafPreference: value.loafPreference });
}
export function profileInput(value) { return validateProfile(value, { saving: true }); }

export function validateLocation(value) {
  exact(value, 'latitude,longitude');
  if (value.latitude === null && value.longitude === null) return null;
  if (typeof value.latitude !== 'number' || typeof value.longitude !== 'number' ||
      !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
      Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) throw new Error('Invalid saved location');
  return immutable({ latitude: value.latitude, longitude: value.longitude });
}

function historicalQuote(value) {
  exact(value, 'batchDiscountAmount,batchDiscountLabel,creditApplied,date,deliveryCharge,discountAmount,discountLabel,giftLabel,itemCount,lines,listSubtotal,problems,totalAmount,valid');
  if (!Array.isArray(value.lines) || !value.lines.length || !validDate(value.date) ||
      value.valid !== true || !Array.isArray(value.problems) || value.problems.length !== 0) throw new Error('Invalid historical quote');
  const lines = validateLineStructure(value.lines.map(row => {
    if (!Object.hasOwn(row, 'specialUnitPrice')) exact(row, 'itemId,lineTotal,name,quantity,unitPrice');
    else exact(row, 'itemId,lineTotal,name,quantity,specialUnitPrice,unitPrice');
    text(row.name, 1, 200);
    if (!amount(row.unitPrice) || !amount(row.lineTotal) ||
        !(row.specialUnitPrice == null || amount(row.specialUnitPrice))) throw new Error('Invalid historical amounts');
    return { itemId: row.itemId, quantity: row.quantity };
  }));
  for (const key of ['listSubtotal', 'discountAmount', 'batchDiscountAmount', 'deliveryCharge', 'creditApplied', 'totalAmount']) {
    if (!amount(value[key])) throw new Error('Invalid historical amounts');
  }
  for (const key of ['discountLabel', 'batchDiscountLabel', 'giftLabel']) {
    if (value[key] !== null) text(value[key], 0, 500);
  }
  if (!Number.isSafeInteger(value.itemCount) || value.itemCount !== lines.reduce((sum, row) => sum + row.quantity, 0)) {
    throw new Error('Invalid historical count');
  }
  return structuredClone(validateQuote(value, lines, value.date));
}
export function validateOrderDetail(value, expectedId, now = Date.now()) {
  exact(value, 'createdAt,expiresAt,fulfillment,id,orderNumber,orderStatus,paymentUrl,quote,status');
  const summary = metadata(value);
  if (expectedId !== undefined && (typeof expectedId !== 'string' || !OPAQUE_ID.test(expectedId) || summary.id !== expectedId)) throw new Error('Unexpected order');
  instant(value.expiresAt);
  if (!Number.isFinite(now) || (value.status !== 'PAYABLE' && value.paymentUrl !== null) ||
      (value.status === 'PAYABLE' && typeof value.paymentUrl !== 'string')) throw new Error('Invalid payment state');
  if (value.status === 'PAYABLE') paymentUrl(value.paymentUrl);
  // Account GET deliberately does not turn uncertain dispatch into EXPIRED.
  const checked = validateCheckout(value, expectedId, now);
  const checkout = value.status === 'CREATING' ? { ...checked, status: 'CREATING' } : checked;
  exact(value.fulfillment, 'address,deliveryPreference,loafPreference,name');
  text(value.fulfillment.name, 1, 100);
  text(value.fulfillment.address, 10, 2000); // Reject U+2028/U+2029 even with an older checkout validator.
  return immutable({ ...summary, ...checkout, fulfillment: fulfillment(value.fulfillment), quote: historicalQuote(value.quote) });
}
export function validateHistory(value, expectedPage) {
  exact(value, 'hasMore,orders,page');
  if (!Number.isInteger(value.page) || value.page < 0 || value.page > 10000 ||
      (expectedPage !== undefined && (!Number.isInteger(expectedPage) || value.page !== expectedPage)) || typeof value.hasMore !== 'boolean' ||
      !Array.isArray(value.orders) || value.orders.length > 10 || (value.hasMore && value.orders.length !== 10)) {
    throw new Error('Invalid order history');
  }
  const seen = new Set();
  const orders = value.orders.map(row => {
    // Older backends omit channel; every such row is a website order.
    const legacy = row && typeof row === 'object' && !Array.isArray(row) && !('channel' in row);
    exact(row, legacy ? summaryKeys : `channel,${summaryKeys}`);
    if (row.channel === 'WHATSAPP') {
      if (row.id !== null || row.status !== null || !orderStatuses.has(row.orderStatus) ||
          (row.deliveryDate !== null && !validDate(row.deliveryDate)) ||
          (row.totalAmount !== null && !amount(row.totalAmount))) throw new Error('Invalid order summary');
      return { channel: 'WHATSAPP', id: null, status: null, orderNumber: text(row.orderNumber, 1, 100),
        createdAt: instant(row.createdAt), orderStatus: row.orderStatus, deliveryDate: row.deliveryDate, totalAmount: row.totalAmount };
    }
    if (!legacy && row.channel !== 'WEB') throw new Error('Invalid order summary');
    const summary = metadata(row);
    if (seen.has(row.id) || !validDate(row.deliveryDate) || !amount(row.totalAmount)) throw new Error('Invalid order summary');
    seen.add(row.id);
    return { ...summary, channel: 'WEB', deliveryDate: row.deliveryDate, totalAmount: row.totalAmount };
  });
  return immutable({ orders, page: value.page, hasMore: value.hasMore });
}