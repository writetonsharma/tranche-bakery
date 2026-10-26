const ROUTES = new Map([
  ['/api/catalog', 'GET'], ['/api/session', 'GET'], ['/api/quote', 'POST'],
  ['/api/auth/challenge', 'POST'], ['/api/auth/verify', 'POST'], ['/api/auth/logout', 'POST']
]);

export class ApiError extends Error {
  constructor(status) { super('Service unavailable. Please try again later.'); this.status = status; }
}

export class StorefrontApi {
  #fetch;
  #csrf;
  constructor(fetcher = globalThis.fetch.bind(globalThis)) { this.#fetch = fetcher; }
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
  async request(path, body, signal) {
    const method = ROUTES.get(path);
    if (!method) throw new Error('Disallowed API route');
    const headers = { Accept: 'application/json' };
    if (method === 'POST') {
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
      if (!response.ok) throw new ApiError(response.status);
      return await response.json();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  async session(signal) { return this.useSession(await this.request('/api/session', undefined, signal)); }
  async authenticate(path, body) { return this.useSession(await this.request(path, body)); }
}