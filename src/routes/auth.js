import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { verifyCredentials } from '../users.js';
import { SESSION_COOKIE } from '../session.js';

/** Middleware: pustí dál jen přihlášeného uživatele, jinak 401. */
export function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Nejste přihlášeni.' });
}

export function createAuthRouter({ pool, loginLimit = 10, loginWindowMs = 15 * 60 * 1000 }) {
  const router = express.Router();

  // Omezení pokusů o přihlášení: počítají se jen neúspěšné pokusy, podle IP
  // (za nginx z X-Forwarded-For díky trust proxy).
  const loginLimiter = rateLimit({
    windowMs: loginWindowMs,
    limit: loginLimit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: 'Příliš mnoho pokusů o přihlášení. Zkuste to znovu za chvíli.' });
    },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body ?? {};
    const user = await verifyCredentials(pool, username, password);
    if (!user) {
      res.status(401).json({ error: 'Nesprávné jméno nebo heslo.' });
      return;
    }
    // Nové id session po přihlášení (ochrana proti session fixation).
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.userId = user.id;
    req.session.username = user.username;
    await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
    res.json({ username: user.username });
  });

  router.post('/logout', async (req, res) => {
    if (req.session) {
      await new Promise((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ username: req.session.username });
  });

  return router;
}
