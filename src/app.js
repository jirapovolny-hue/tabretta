import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { requireCsrfHeader } from './middleware/csrf.js';
import { createSessionMiddleware } from './session.js';
import { createApiRouter } from './routes/api.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * Sestaví Express aplikaci. Závislosti (databáze, konfigurace) se předávají
 * zvenku. S `pool` připojí session, celé API a stránky; bez něj (testy
 * middlewaru) jen předaný `apiRouter`.
 */
export function createApp({ config, pool = null, apiRouter = null, loginLimit, pruneSessions = true }) {
  const sessionMiddleware = pool ? createSessionMiddleware({ pool, config, pruneSessions }) : null;
  apiRouter ??= pool ? createApiRouter({ pool, config, loginLimit }) : null;
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

  // Veřejné jsou jen styly, skript a ikona přihlašovací stránky.
  app.use('/static', express.static(path.join(PUBLIC_DIR, 'static'), { index: false, fallthrough: false }));

  if (sessionMiddleware) app.use(sessionMiddleware);

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '100kb' }));
  api.use(requireCsrfHeader);
  if (apiRouter) api.use(apiRouter);
  api.use((req, res) => res.status(404).json({ error: 'Nenalezeno.' }));
  app.use('/api', api);

  if (sessionMiddleware) {
    const noStore = (res) => res.set('Cache-Control', 'no-store');

    app.get('/login', (req, res) => {
      if (req.session?.userId) return res.redirect(303, '/');
      noStore(res);
      res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
    });

    // Vše ostatní jen po přihlášení; nepřihlášeného přesměrujeme na /login.
    app.use((req, res, next) => {
      if (req.session?.userId) return next();
      if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, '/login');
      res.status(401).end();
    });

    app.get('/', (req, res) => {
      noStore(res);
      res.sendFile(path.join(PUBLIC_DIR, 'app', 'index.html'));
    });
    app.use(
      '/app',
      express.static(path.join(PUBLIC_DIR, 'app'), {
        index: false,
        setHeaders: (res) => res.set('Cache-Control', 'private, no-cache'),
      }),
    );
  }

  app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('Nenalezeno.'));
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
