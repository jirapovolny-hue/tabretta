import path from 'node:path';

// Aplikace poslouchá výhradně na loopbacku (zadání sekce 6), proto to není konfigurovatelné.
export const HOST = '127.0.0.1';

export class ConfigError extends Error {}

/**
 * Načte konfiguraci z proměnných prostředí. Nic se nezapisuje napevno:
 * cesty, port a tajemství dodává systemd přes EnvironmentFile=.
 */
export function loadConfig(env = process.env) {
  const errors = [];

  const port = env.PORT === undefined || env.PORT === '' ? 3100 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT musí být celé číslo 1 až 65535');
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) errors.push('chybí DATABASE_URL');

  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    errors.push('SESSION_SECRET musí mít aspoň 32 znaků');
  }

  const uploadDir = env.UPLOAD_DIR;
  if (!uploadDir || !path.isAbsolute(uploadDir)) {
    errors.push('UPLOAD_DIR musí být absolutní cesta');
  }

  // Výchozí je secure cookie (za nginx s HTTPS). Jen pro lokální vývoj přes http lze vypnout.
  const cookieSecure = env.COOKIE_SECURE !== '0';

  if (errors.length) {
    throw new ConfigError(`Chybná konfigurace: ${errors.join('; ')}`);
  }

  return { port, host: HOST, databaseUrl, sessionSecret, uploadDir, cookieSecure };
}
