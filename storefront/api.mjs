import { OPAQUE_ID, PROBLEMS } from './checkout-model.mjs';
import { shoppingInput } from './shopping-model.mjs';

const ROUTES = new Map([
  ['/api/catalog', 'GET'], ['/api/session', 'GET'], ['/api/quote', 'POST'], ['/api/shopping', 'POST'],
  ['/api/auth/challenge', 'POST'], ['/api/auth/verify', 'POST'], ['/api/auth/logout', 'POST']
]);

const ACCOUNT_ORDERS = /^\/api\/account\/orders(?:\?page=(?:0|[1-9][0-9]{0,3}|10000))?$(?![\s\S])/;
const ACCOUNT_DETAIL = /^\/api\/account\/orders\/[A-Za-z0-9_-]{32}$(?![\s\S])/;
function profileInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).sort().join(',') !== 'address,deliveryPreference,loafPreference,name,version' ||
      !Number.isSafeInteger(value.version) || value.version < 0 || value.version >= Number.MAX_SAFE_INTEGER ||
      !['GATE', 'DOOR', 'IN_PERSON'].includes(value.deliveryPreference) ||
      !['SLICED', 'WHOLE'].includes(value.loafPreference)) throw new Error('Invalid profile');
  const text = (key, min, max) => {
    if (typeof value[key] !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value[key])) throw new Error('Invalid profile');
    const trimmed = value[key].trim();
    if (trimmed.length < min || trimmed.length > max) throw new Error('Invalid profile');
    return trimmed;
  };
  return { version: value.version, name: text('name', 1, 100), address: text('address', 10, 2000),
    deliveryPreference: value.deliveryPreference, loafPreference: value.loafPreference };
}

export class ApiError extends Error {
  constructor(status, code) { super('Service unavailable. Please try again later.'); this.status = status; this.code = code; }
}

export class StorefrontApi {
  #fetch;
  #csrf;
  #checkout;
  constructor(fetcher = globalThis.fetch.bind(globalThis), { checkoutEnabled = false } = {}) {
    this.#fetch = fetcher; this.#checkout = checkoutEnabled === true;
  }
  clearSession() { this.#csrf = undefined; }
  useSession(view) {
    if (!view || typeof view.authenticated !== 'boolean' ||
        view.csrfHeaderName !== 'X-XSRF-TOKEN' || typeof view.csrfToken !== 'string' ||
        !view.csrfToken || /[\r\n]/.test(view.csrfToken) ||
        (view.authenticated && (!Number.isSafeInteger(view.customer?.id) || view.customer.id <= 0))) {
      this.clearSession();
      throw new Error('Invalid session');
    }
    this.#csrf = { name: view.csrfHeaderName, token: view.csrfToken };
    return view;
  }
  async request(path, body, signal, requestedMethod) {
    let method = ROUTES.get(path);
    const accountRoute = this.#checkout && typeof path === 'string' &&
      (path === '/api/account/profile' || path === '/api/account/checkout' ||
        ACCOUNT_ORDERS.test(path) || ACCOUNT_DETAIL.test(path));
    if (accountRoute) {
      method = path === '/api/account/profile' ?
        (requestedMethod === undefined ? (body === undefined ? 'GET' : 'PUT') : requestedMethod) : 'GET';
      if (!['GET', 'PUT'].includes(method)) throw new Error('Disallowed API method');
    }
    const checkoutRoute = this.#checkout && (['/api/cart', '/api/checkout/prepare', '/api/checkout'].includes(path) ||
      (typeof path === 'string' && path.startsWith('/api/checkout/') && OPAQUE_ID.test(path.slice('/api/checkout/'.length))));
    if (checkoutRoute) {
      method = path === '/api/cart' ? (requestedMethod || (body === undefined ? 'GET' : 'PUT')) :
        ['/api/checkout/prepare', '/api/checkout'].includes(path) ? 'POST' : 'GET';
      if (path === '/api/cart' && !['GET', 'PUT'].includes(method)) throw new Error('Disallowed API method');
    }
    if (!method) throw new Error('Disallowed API route');
    if (requestedMethod !== undefined && requestedMethod !== method) throw new Error('Disallowed API method');
    if (method === 'GET' && body !== undefined) throw new Error('Disallowed API body');
    if (path === '/api/shopping') body = shoppingInput(body);
    if (accountRoute && method === 'PUT') body = profileInput(body);
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') {
      if (!this.#csrf) throw new Error('Session bootstrap required');
      headers[this.#csrf.name] = this.#csrf.token;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 15000);
    try {
      const response = await this.#fetch(path, {
        method, headers, signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
        redirect: 'error', ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      // Never display/log an error payload, which could contain submitted auth data.
      if (!response.ok) {
        let code;
        // Only gated checkout/account failures are parsed: never retain server text/PII.
        if (checkoutRoute || accountRoute) {
          try {
            const payload = await response.json();
            const candidate = payload?.problems?.[0]?.code;
            if (typeof candidate === 'string' && candidate.length <= 48 && Object.hasOwn(PROBLEMS, candidate)) code = candidate;
          } catch { /* Framework 403/HTML errors need not have JSON. */ }
        }
        throw new ApiError(response.status, code);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  async session(signal) { return this.useSession(await this.request('/api/session', undefined, signal)); }
  async authenticate(path, body) { return this.useSession(await this.request(path, body)); }
}