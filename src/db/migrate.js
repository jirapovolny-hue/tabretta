import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');

// Libovolné pevné číslo; zámek brání dvěma současným běhům migrací.
const LOCK_KEY = 742_519_001;

const MIGRATION_NAME = /^\d{3}_[a-z0-9_]+\.sql$/;

export class MigrationError extends Error {}

async function listMigrations(dir) {
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  for (const n of names) {
    if (!MIGRATION_NAME.test(n)) throw new MigrationError(`Neplatný název migrace: ${n} (čekám NNN_nazev.sql)`);
  }
  return Promise.all(
    names.map(async (name) => {
      const sql = await fs.readFile(path.join(dir, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      return { name, sql, checksum };
    }),
  );
}

/**
 * Aplikuje dosud neprovedené migrace, každou ve vlastní transakci, a eviduje je
 * v tabulce schema_migrations. Opakované spuštění nic nedělá. Změněný obsah
 * už provedené migrace je chyba (migrace se nemají upravovat, jen přidávat).
 * Vrací seznam nově provedených migrací.
 */
export async function runMigrations(pool, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const migrations = await listMigrations(dir);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const name of applied.keys()) {
      if (!migrations.some((m) => m.name === name)) {
        log(`Varování: migrace ${name} je v evidenci, ale soubor chybí.`);
      }
    }

    const done = [];
    for (const m of migrations) {
      const known = applied.get(m.name);
      if (known) {
        if (known !== m.checksum) {
          throw new MigrationError(`Migrace ${m.name} už proběhla, ale její soubor se od té doby změnil.`);
        }
        continue;
      }
      log(`Spouštím ${m.name}`);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [m.name, m.checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new MigrationError(`Migrace ${m.name} selhala: ${err.message}`);
      }
      done.push(m.name);
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}
