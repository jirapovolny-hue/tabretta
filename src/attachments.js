import crypto from 'node:crypto';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// Typy, které prohlížeč smí dostat s původním Content-Type. Vše ostatní
// (HTML, SVG, skripty, neznámé) jde jako application/octet-stream.
const SAFE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

/** Vygenerovaný název souboru na disku, bez přípony a bez vazby na původní název. */
export function generateStoredName() {
  return crypto.randomBytes(24).toString('hex');
}

/** Platný název uloženého souboru (ochrana proti path traversal při čtení z DB). */
export function isValidStoredName(name) {
  return typeof name === 'string' && /^[0-9a-f]{48}$/.test(name);
}

export function safeContentType(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!SAFE_MIME_TYPES.has(base)) return 'application/octet-stream';
  return base === 'text/plain' || base === 'text/csv' ? `${base}; charset=utf-8` : base;
}

/** Původní název zkrácený a zbavený řídicích znaků a lomítek; ukládá se jen do DB. */
export function sanitizeOriginalName(name) {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .trim()
    .slice(0, 255);
  return cleaned || 'soubor';
}

function asciiFallback(name) {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return ascii || 'soubor';
}

export function contentDisposition(originalName) {
  const name = sanitizeOriginalName(originalName);
  return `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Hlavičky pro stažení přílohy: vždy jako příloha, bez sniffování, bez spuštění. */
export function setDownloadHeaders(res, { originalName, mimeType, sizeBytes }) {
  res.set({
    'Content-Type': safeContentType(mimeType),
    'Content-Disposition': contentDisposition(originalName),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  if (Number.isFinite(sizeBytes)) res.set('Content-Length', String(sizeBytes));
}
