import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runMigrations, MIGRATIONS_DIR, MigrationError } from '../src/db/migrate.js';
import { createUser, verifyCredentials, UserError } from '../src/users.js';
import { createTestPool, resetDatabase, skipWithoutDb } from './helpers/db.js';

let pool;

before(async () => {
  if (skipWithoutDb) return;
  pool = createTestPool();
  await resetDatabase(pool);
});

after(async () => {
  if (pool) await pool.end();
});

test('migrace: první běh vytvoří schéma, druhý nic nedělá', { skip: skipWithoutDb }, async () => {
  const first = await runMigrations(pool);
  assert.ok(first.includes('001_init.sql'));
  const second = await runMigrations(pool);
  assert.deepEqual(second, []);
  const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1");
  const tables = rows.map((r) => r.tablename);
  for (const t of ['users', 'projects', 'tasks', 'task_links', 'task_attachments', 'shopping_items', 'task_dependencies', 'session', 'schema_migrations']) {
    assert.ok(tables.includes(t), `chybí tabulka ${t}`);
  }
});

test('migrace: změněný soubor už provedené migrace je chyba', { skip: skipWithoutDb }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tabretta-mig-'));
  try {
    const original = await fs.readFile(path.join(MIGRATIONS_DIR, '001_init.sql'), 'utf8');
    await fs.writeFile(path.join(dir, '001_init.sql'), `${original}\n-- změna\n`);
    await assert.rejects(runMigrations(pool, { dir }), MigrationError);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('migrace: chybná migrace se vrátí celá a nezapíše do evidence', { skip: skipWithoutDb }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tabretta-mig-'));
  try {
    await fs.copyFile(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(dir, '001_init.sql'));
    await fs.writeFile(path.join(dir, '999_chyba.sql'), 'CREATE TABLE zz_test (id int);\nSELECT * FROM neexistuje;\n');
    await assert.rejects(runMigrations(pool, { dir }), /999_chyba\.sql/);
    const t = await pool.query("SELECT to_regclass('public.zz_test') AS t");
    assert.equal(t.rows[0].t, null);
    const m = await pool.query("SELECT 1 FROM schema_migrations WHERE name = '999_chyba.sql'");
    assert.equal(m.rowCount, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('schéma: kontroly stavu, závislosti na sebe a odkazů', { skip: skipWithoutDb }, async () => {
  const u = await pool.query("INSERT INTO users (username, password_hash) VALUES ('schema_test', 'x') RETURNING id");
  const p = await pool.query("INSERT INTO projects (user_id, name, kind) VALUES ($1, 'P', 'prace') RETURNING id", [u.rows[0].id]);
  const t = await pool.query("INSERT INTO tasks (project_id, title) VALUES ($1, 'T') RETURNING id, status", [p.rows[0].id]);
  const taskId = t.rows[0].id;
  assert.equal(t.rows[0].status, 'k_udelani');

  await assert.rejects(pool.query("UPDATE tasks SET status = 'jiny' WHERE id = $1", [taskId]), { code: '23514' });
  await assert.rejects(pool.query("INSERT INTO projects (user_id, name, kind) VALUES ($1, 'X', 'jine')", [u.rows[0].id]), { code: '23514' });
  await assert.rejects(pool.query('INSERT INTO task_dependencies VALUES ($1, $1)', [taskId]), { code: '23514' });
  await assert.rejects(pool.query("INSERT INTO task_links (task_id, url) VALUES ($1, 'javascript:alert(1)')", [taskId]), { code: '23514' });

  // Kaskádové mazání: smazání projektu smaže úkoly i navázané záznamy.
  await pool.query("INSERT INTO task_links (task_id, url) VALUES ($1, 'https://example.com')", [taskId]);
  await pool.query("INSERT INTO shopping_items (task_id, name) VALUES ($1, 'mléko')", [taskId]);
  await pool.query('DELETE FROM projects WHERE id = $1', [p.rows[0].id]);
  for (const table of ['tasks', 'task_links', 'shopping_items']) {
    const c = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    assert.equal(c.rows[0].n, 0, `v ${table} zůstaly řádky`);
  }
  await pool.query('DELETE FROM users WHERE id = $1', [u.rows[0].id]);
});

test('uživatelé: vytvoření, duplicita, ověření hesla', { skip: skipWithoutDb }, async () => {
  const user = await createUser(pool, 'jirka', 'dlouhe-heslo-123');
  assert.equal(user.username, 'jirka');
  await assert.rejects(createUser(pool, 'jirka', 'dlouhe-heslo-123'), UserError);
  await assert.rejects(createUser(pool, 'kratke', 'abc'), UserError);
  await assert.rejects(createUser(pool, 'špatné jméno', 'dlouhe-heslo-123'), UserError);

  const { rows } = await pool.query("SELECT password_hash FROM users WHERE username = 'jirka'");
  assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/);

  assert.deepEqual(await verifyCredentials(pool, 'jirka', 'dlouhe-heslo-123'), { id: user.id, username: 'jirka' });
  assert.equal(await verifyCredentials(pool, 'jirka', 'spatne-heslo-123'), null);
  assert.equal(await verifyCredentials(pool, 'nikdo', 'dlouhe-heslo-123'), null);
  assert.equal(await verifyCredentials(pool, undefined, undefined), null);
});
