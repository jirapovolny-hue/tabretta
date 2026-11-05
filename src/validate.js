export const MAX_URL_LENGTH = 2000;

/**
 * Vrátí normalizovanou adresu, pokud je to absolutní http(s) URL, jinak null.
 * Brání odkazům typu javascript:, data: apod. (zadání sekce 5, Odkazy).
 */
export function normalizeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url.href;
}
