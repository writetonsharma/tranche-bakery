import { validDate } from './model.mjs';
import { fulfillment, immutable, paymentUrl } from './checkout-model.mjs';

export const DAYS = Object.freeze(['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
const STATUSES = new Set(['PENDING_PAYMENT', 'ACTIVE']);
// Week rows are SCHEDULED until their ₹0 order exists, then carry that order's status.
const DELIVERY_STATUSES = new Set(['SCHEDULED', 'INVOICED', 'PENDING_CONFIRMATION', 'PENDING_PAYMENT_SCREENSHOT',
  'PAYMENT_SCREENSHOT_RECEIVED', 'PAYMENT_SCREENSHOT_VERIFIED', 'PAYMENT_REVIEW_REQUIRED',
  'CONFIRMED', 'IN_BAKING', 'OUT_FOR_DELIVERY', 'CANCELLED', 'COMPLETED']);
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== keys) throw new Error('Invalid subscription response');
}
function text(value, min, max) {
  if (typeof value !== 'string' || controls.test(value) || value.trim().length < min ||
      value.trim().length > max) throw new Error('Invalid subscription text');
  return value.trim();
}
function list(value, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('Invalid subscription list');
  return value;
}
const amount = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e7) throw new Error('Invalid amount');
  return value;
};
const count = (value, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid count');
  return value;
};
const date = value => { if (!validDate(value)) throw new Error('Invalid date'); return value; };
const day = value => { if (!DAYS.includes(value)) throw new Error('Invalid day'); return value; };
const portion = value => { if (!['HALF', 'FULL'].includes(value)) throw new Error('Invalid portion'); return value; };

export function validatePlans(value) {
  exact(value, 'audience,days,plans');
  if (!['PUBLIC', 'FF'].includes(value.audience)) throw new Error('Invalid audience');
  const codes = new Set();
  const plans = list(value.plans, 0, 20).map(plan => {
    exact(plan, 'code,deliveryCharge,freeWeeks,name,options,paidWeeks,tier,upfront,weeklyPrice');
    if (typeof plan.code !== 'string' || !/^[A-Z0-9_]{1,50}$/.test(plan.code) || codes.has(plan.code)) throw new Error('Invalid plan code');
    codes.add(plan.code);
    const indexes = new Set();
    const options = list(plan.options, 1, 20).map(option => {
      exact(option, 'components,description,index,label');
      if (indexes.has(count(option.index, 0, 20))) throw new Error('Duplicate option');
      indexes.add(option.index);
      return { index: option.index, label: text(option.label, 1, 100),
        description: option.description === null ? null : text(option.description, 0, 200),
        components: list(option.components, 1, 6).map(component => {
          exact(component, 'choices,portion,quantity,type');
          const choices = list(component.choices, 1, 40).map(choice => text(choice, 1, 100));
          if (new Set(choices).size !== choices.length) throw new Error('Duplicate choice');
          return { type: text(component.type, 1, 20), portion: portion(component.portion),
            quantity: count(component.quantity, 1, 24), choices };
        }) };
    });
    return { code: plan.code, name: text(plan.name, 1, 100), tier: text(plan.tier, 1, 20),
      weeklyPrice: amount(plan.weeklyPrice), deliveryCharge: amount(plan.deliveryCharge),
      paidWeeks: count(plan.paidWeeks, 1, 52), freeWeeks: count(plan.freeWeeks, 0, 52), upfront: amount(plan.upfront), options };
  });
  const seen = new Set();
  const days = list(value.days, 1, 7).map(row => {
    exact(row, 'day,firstDelivery');
    if (seen.has(day(row.day))) throw new Error('Duplicate day');
    seen.add(row.day);
    return { day: row.day, firstDelivery: date(row.firstDelivery) };
  });
  return immutable({ audience: value.audience, plans, days });
}

export function validateCurrent(value) {
  exact(value, 'subscription');
  if (value.subscription === null) return null;
  const sub = value.subscription;
  exact(sub, 'amount,channel,creditApplied,deliveries,deliveryCharge,deliveryDay,endDate,freeWeeks,fulfillment,items,paidWeeks,paymentUrl,planName,savings,startDate,status,tier,weeklyPrice');
  if (!STATUSES.has(sub.status) || !['WEB', 'WHATSAPP'].includes(sub.channel)) throw new Error('Invalid subscription status');
  const pending = sub.status === 'PENDING_PAYMENT';
  if (pending ? sub.startDate !== null || sub.endDate !== null : !validDate(sub.startDate) || !validDate(sub.endDate)) {
    throw new Error('Invalid subscription dates');
  }
  if (!pending && sub.paymentUrl !== null) throw new Error('Invalid subscription payment');
  const items = list(sub.items, 1, 6).map(item => {
    exact(item, 'name,portion,quantity');
    return { name: text(item.name, 1, 100), quantity: count(item.quantity, 1, 24), portion: portion(item.portion) };
  });
  const deliveries = list(sub.deliveries, 1, 104).map((row, index) => {
    exact(row, 'date,status,week');
    if (row.week !== index + 1 || !DELIVERY_STATUSES.has(row.status)) throw new Error('Invalid delivery');
    return { week: row.week, date: date(row.date), status: row.status };
  });
  let details = null;
  if (sub.fulfillment !== null) {
    exact(sub.fulfillment, 'address,deliveryPreference,loafPreference,name');
    details = fulfillment(sub.fulfillment);
  }
  return immutable({ status: sub.status, channel: sub.channel, planName: text(sub.planName, 1, 100), tier: text(sub.tier, 1, 20),
    weeklyPrice: amount(sub.weeklyPrice), deliveryCharge: amount(sub.deliveryCharge),
    paidWeeks: count(sub.paidWeeks, 1, 52), freeWeeks: count(sub.freeWeeks, 0, 52),
    creditApplied: sub.creditApplied === null ? 0 : amount(sub.creditApplied), amount: amount(sub.amount),
    deliveryDay: day(sub.deliveryDay), startDate: sub.startDate, endDate: sub.endDate, items, deliveries,
    fulfillment: details, paymentUrl: pending && sub.paymentUrl !== null ? paymentUrl(sub.paymentUrl) : null,
    savings: sub.savings === null ? 0 : amount(sub.savings) });
}

// Only the exact fields the server accepts. Choices must come from the validated plans.
export function subscriptionInput(value, plans) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'address,deliveryDay,deliveryPreference,items,loafPreference,name,option,planCode') {
    throw new Error('Invalid subscription request');
  }
  const plan = plans?.plans?.find(row => row.code === value.planCode);
  const option = plan?.options.find(row => row.index === value.option);
  if (!option || !Array.isArray(value.items) || value.items.length !== option.components.length ||
      value.items.some((item, index) => !option.components[index].choices.includes(item)) ||
      !plans.days.some(row => row.day === value.deliveryDay)) throw new Error('Invalid subscription choice');
  const details = fulfillment({ name: value.name, address: value.address,
    deliveryPreference: value.deliveryPreference, loafPreference: value.loafPreference });
  return { planCode: plan.code, option: option.index, items: [...value.items], deliveryDay: value.deliveryDay, ...details };
}
