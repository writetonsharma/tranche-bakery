// Keep the existing accepted formats; only bare Indian mobile input gains 91.
export function normalizePhone(value) {
  if (typeof value !== 'string') return null;
  const phone = value.trim();
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) return null;
  return /^\d{10}$/.test(phone) ? `91${phone}` : phone;
}