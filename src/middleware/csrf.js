const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'XMLHttpRequest';

/**
 * Ochrana proti CSRF navíc k cookie sameSite=lax: každý požadavek měnící data
 * (včetně nahrávání souborů) musí nést vlastní hlavičku. Cizí stránka ji
 * bez CORS preflightu poslat nemůže a CORS aplikace nepovoluje.
 */
export function requireCsrfHeader(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get(CSRF_HEADER) === CSRF_VALUE) return next();
  res.status(403).json({ error: 'Chybí ochranná hlavička požadavku.' });
}
