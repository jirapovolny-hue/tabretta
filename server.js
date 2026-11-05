import { createApp } from './src/app.js';
import { loadConfig, ConfigError } from './src/config.js';

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

const app = createApp({ config });

const server = app.listen(config.port, config.host, () => {
  console.log(`Tabretta poslouchá na http://${config.host}:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal}: ukončuji`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
