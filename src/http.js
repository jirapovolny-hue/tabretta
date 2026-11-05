// Chyby a validace vstupů pro API. Zprávy jsou česky a smí se ukázat uživateli.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Nenalezeno.') => new HttpError(404, msg);

export const PROJECT_KINDS = ['prace', 'soukrome'];
export const TASK_STATUSES = ['napad', 'k_udelani', 'rozdelane', 'hotovo'];

/** Kladné celé číslo (id z URL nebo těla), jinak 404/400. */
export function parseId(value, { name = 'id', status = 404 } = {}) {
  const n = typeof value === 'number' ? value : /^\d{1,15}$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw status === 404 ? notFound() : badRequest(`Neplatné ${name}.`);
  }
  return n;
}

export function requiredText(value, name, max) {
  if (typeof value !== 'string') throw badRequest(`Chybí ${name}.`);
  const v = value.trim();
  if (!v) throw badRequest(`Chybí ${name}.`);
  if (v.length > max) throw badRequest(`${capitalize(name)} je příliš dlouhý (max. ${max} znaků).`);
  return v;
}

/** Volitelný delší text (popis): zachová odřádkování, ořízne jen okraje. */
export function optionalText(value, name, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest(`Neplatný ${name}.`);
  const v = value.replace(/\r\n?/g, '\n').trim();
  if (v.length > max) throw badRequest(`${capitalize(name)} je příliš dlouhý (max. ${max} znaků).`);
  return v;
}

/** Volitelný krátký text, prázdný = null. */
export function nullableText(value, name, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`Neplatný ${name}.`);
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) throw badRequest(`${capitalize(name)} je příliš dlouhý (max. ${max} znaků).`);
  return v;
}

export function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) throw badRequest(`Neplatný ${name}.`);
  return value;
}

export function bool(value, name) {
  if (typeof value !== 'boolean') throw badRequest(`Neplatná hodnota ${name}.`);
  return value;
}

export function int(value, name, { min = -2147483648, max = 2147483647 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw badRequest(`Neplatná hodnota ${name}.`);
  return value;
}

/** Datum RRRR-MM-DD nebo null. */
export function nullableDate(value, name = 'termín') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`Neplatný ${name}.`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw badRequest(`Neplatný ${name}.`);
  return value;
}

/** Nezáporné číslo s omezeným počtem desetinných míst (množství, cena). */
export function decimal(value, name, { min = 0, exclusiveMin = false, max = 999_999_999, nullable = false, places = 2 } = {}) {
  if (nullable && (value === null || value === '')) return null;
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n > max || (exclusiveMin ? n <= min : n < min)) {
    throw badRequest(`Neplatná hodnota ${name}.`);
  }
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

/** Jen povolená pole z těla PATCH požadavku; prázdný výsledek je chyba. */
export function pickPatch(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Neplatné tělo požadavku.');
  const out = {};
  for (const key of allowed) if (Object.hasOwn(body, key)) out[key] = body[key];
  if (!Object.keys(out).length) throw badRequest('Nic ke změně.');
  return out;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
