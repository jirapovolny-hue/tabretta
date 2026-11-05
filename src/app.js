import express from 'express';
import helmet from 'helmet';
import { requireCsrfHeader } from './middleware/csrf.js';

/**
 * Sestaví Express aplikaci. Závislosti (databáze, úložiště session, konfigurace)
 * se předávají zvenku, aby šla aplikace testovat i bez databáze.
 */
export function createApp({ config, sessionMiddleware = null, apiRouter = null }) {
  const app = express();

  // Před aplikací stojí jen nginx na stejném stroji.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          ...(config.cookieSecure ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      // HSTS nastavuje aplikace jen za HTTPS (za nginx); lokálně přes http by škodilo.
      strictTransportSecurity: config.cookieSecure ? undefined : false,
      referrerPolicy: { policy: 'same-origin' },
    }),
  );

  if (sessionMiddleware) app.use(sessionMiddleware);

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(requireCsrfHeader);
  if (apiRouter) api.use(apiRouter);
  api.use((req, res) => res.status(404).json({ error: 'Nenalezeno.' }));
  app.use('/api', api);

  app.use(errorHandler);
  return app;
}

// Chyby vracíme jako JSON bez detailů (stack trace jen do logu).
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 ? 'Interní chyba serveru.' : err.expose ? err.message : 'Neplatný požadavek.';
  if (res.headersSent) return;
  res.status(status).json({ error: message });
}
