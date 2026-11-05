#!/usr/bin/env node
// Použití: DATABASE_URL=... npm run migrate
// (správce spouští pod rolí tabretta_user s proměnnými z /etc/tabretta/tabretta.env)
import { createPool } from '../src/db/pool.js';
import { runMigrations, MigrationError } from '../src/db/migrate.js';

if (!process.env.DATABASE_URL) {
  console.error('Chybí DATABASE_URL.');
  process.exit(1);
}

const pool = createPool(process.env.DATABASE_URL, { max: 1 });
try {
  const done = await runMigrations(pool, { log: (msg) => console.log(msg) });
  console.log(done.length ? `Hotovo, provedeno migrací: ${done.length}.` : 'Databáze je aktuální, nic k provedení.');
} catch (err) {
  console.error(err instanceof MigrationError ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
