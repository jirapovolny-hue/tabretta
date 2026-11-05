// Jednoduchý HTTP klient pro testy: drží session cookie a posílá CSRF hlavičku.
export class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = null;
    this.lastSetCookie = null;
  }

  async request(method, path, { json, body, headers = {}, csrf = true } = {}) {
    const h = { ...headers };
    if (csrf) h['X-Requested-With'] = 'XMLHttpRequest';
    if (this.cookie) h.Cookie = this.cookie;
    let payload = body;
    if (json !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    const res = await fetch(this.baseUrl + path, { method, headers: h, body: payload, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.lastSetCookie = setCookie;
      const pair = setCookie.split(';')[0];
      this.cookie = /=$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(setCookie) ? null : pair;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, data };
  }

  get(path, opts) {
    return this.request('GET', path, opts);
  }
  post(path, json, opts = {}) {
    return this.request('POST', path, { ...opts, json });
  }
  patch(path, json, opts = {}) {
    return this.request('PATCH', path, { ...opts, json });
  }
  delete(path, opts) {
    return this.request('DELETE', path, opts);
  }
  upload(path, { name, content, type = 'application/octet-stream' }, opts = {}) {
    const form = new FormData();
    form.append('file', new Blob([content], { type }), name);
    return this.request('POST', path, { ...opts, body: form });
  }
  async login(username, password) {
    return this.post('/api/login', { username, password });
  }
}
