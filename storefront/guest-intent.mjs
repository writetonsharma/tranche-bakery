import { STORAGE_KEY } from './model.mjs';

// Anonymous-only receipt: no account identifier, cart/version, date or PII.
// A server CAS version cannot prove which writer committed after a lost reply.
export const GUEST_RECEIPT_KEY = 'tranche.preview.guest-save-pending.v1';
export class GuestIntent {
  constructor(storage) { this.storage = storage; }
  retain() { this.retaining = true; }
  hasRetained() {
    try { const raw = this.storage?.getItem(STORAGE_KEY); return raw != null && raw !== '[]'; }
    catch { return true; }
  }
  uncertain() {
    try { return this.storage?.getItem(GUEST_RECEIPT_KEY) != null; }
    catch { return true; } // Unreadable durable state must never replay additions.
  }
  beforeSave() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw == null || raw === '[]') return true;
      if (!this.claimed && this.uncertain()) return false;
      this.storage.setItem(GUEST_RECEIPT_KEY, 'pending');
      this.claimed = this.storage.getItem(GUEST_RECEIPT_KEY) === 'pending';
      return this.claimed;
    } catch { return false; } // Do not send durable guest intent without a receipt.
  }
  accepted() {
    try {
      // Remove intent first: a crash/removal failure leaves a conservative fence.
      this.storage?.removeItem(STORAGE_KEY);
      if (this.storage?.getItem(STORAGE_KEY) != null) return false;
      this.storage?.removeItem(GUEST_RECEIPT_KEY);
      const cleared = this.storage?.getItem(GUEST_RECEIPT_KEY) == null;
      if (cleared) { this.claimed = false; this.retaining = false; }
      return cleared;
    } catch { return false; }
  }
}