// Volání JSON API. Každý požadavek nese CSRF hlavičku; 401 vede na přihlášení.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const FALLBACK = {
  413: 'Soubor je příliš velký (max. 25 MB).',
  429: 'Příliš mnoho požadavků, zkuste to za chvíli.',
};

export async function api(method, path, body) {
  const options = { method, headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError(0, 'Server je nedostupný. Zkontrolujte připojení.');
  }
  if (res.status === 401 && path !== '/login') {
    window.location.replace('/login');
    throw new ApiError(401, 'Nejste přihlášeni.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || FALLBACK[res.status] || `Chyba serveru (${res.status}).`);
  return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body = {}) => api('POST', path, body);
export const patch = (path, body) => api('PATCH', path, body);
export const del = (path) => api('DELETE', path);
