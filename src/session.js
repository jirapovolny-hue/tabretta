import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

export const SESSION_COOKIE = 'tabretta.sid';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dní

const PgStore = connectPgSimple(session);

export function createSessionMiddleware({ pool, config, pruneSessions = true }) {
  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store: new PgStore({
      pool,
      tableName: 'session',
      createTableIfMissing: false, // tabulku vytváří migrace
      pruneSessionInterval: pruneSessions ? 15 * 60 : false,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    },
  });
}
