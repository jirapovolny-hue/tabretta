import { createPool } from '../../src/db/pool.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Důvod přeskočení testů s databází, nebo false. */
export const skipWithoutDb = TEST_DATABASE_URL ? false : 'chybí TEST_DATABASE_URL (~/.config/tabretta/test.env)';

export function createTestPool() {
  return createPool(TEST_DATABASE_URL, { max: 4 });
}

/** Smaže všechny tabulky ve schématu public testovací databáze. */
export async function resetDatabase(pool) {
  const { rows } = await pool.query('SELECT current_database() AS db');
  if (rows[0].db !== 'tabretta_dev') {
    throw new Error(`Odmítám mazat tabulky v databázi ${rows[0].db}, testy smí jen do tabretta_dev.`);
  }
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  for (const { tablename } of tables.rows) {
    await pool.query(`DROP TABLE IF EXISTS public."${tablename.replaceAll('"', '""')}" CASCADE`);
  }
}
