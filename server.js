import fs from 'node:fs/promises';
import { createApp } from './src/app.js';
import { loadConfig, ConfigError } from './src/config.js';
import { createPool } from './src/db/pool.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

// Adresář příloh vytváří správce; aplikace jen ověří, že do něj smí zapisovat.
try {
  await fs.access(config.uploadDir, fs.constants.W_OK);
} catch {
  console.error(`UPLOAD_DIR (${config.uploadDir}) neexistuje nebo do něj nelze zapisovat.`);
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
pool.on('error', (err) => console.error('Chyba spojení s databází:', err.message));

const app = createApp({ config, pool });

const server = app.listen(config.port, config.host, () => {
  console.log(`Tabretta poslouchá na http://${config.host}:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal}: ukončuji`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
