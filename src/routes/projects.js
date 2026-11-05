import express from 'express';
import { withTransaction } from '../db/pool.js';
import { getOwnedProject, storedNamesForProject } from '../db/access.js';
import { removeStoredFiles } from '../files.js';
import {
  PROJECT_KINDS,
  badRequest,
  bool,
  int,
  oneOf,
  optionalText,
  parseId,
  pickPatch,
  requiredText,
} from '../http.js';

const PROJECT_COLUMNS = 'id, name, description, kind, archived, sort_order, created_at, updated_at';

export function createProjectsRouter({ pool, config }) {
  const router = express.Router();

  // Seznam projektů přihlášeného uživatele; ?kind=prace|soukrome, ?archived=1
  router.get('/projects', async (req, res) => {
    const kind = req.query.kind ? oneOf(req.query.kind, PROJECT_KINDS, 'druh projektu') : null;
    const archived = req.query.archived === '1';
    const { rows } = await pool.query(
      `SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE user_id = $1 AND archived = $2 AND ($3::text IS NULL OR kind = $3)
        ORDER BY sort_order, id`,
      [req.session.userId, archived, kind],
    );
    res.json(rows);
  });

  router.post('/projects', async (req, res) => {
    const body = req.body ?? {};
    const name = requiredText(body.name, 'název', 200);
    const kind = oneOf(body.kind, PROJECT_KINDS, 'druh projektu');
    const description = optionalText(body.description, 'popis', 20000);
    const { rows } = await pool.query(
      `INSERT INTO projects (user_id, name, kind, description, sort_order)
       VALUES ($1, $2, $3, $4,
               (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM projects WHERE user_id = $1))
       RETURNING ${PROJECT_COLUMNS}`,
      [req.session.userId, name, kind, description],
    );
    res.status(201).json(rows[0]);
  });

  router.get('/projects/:id', async (req, res) => {
    res.json(await getOwnedProject(pool, req.session.userId, parseId(req.params.id)));
  });

  router.patch('/projects/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const patch = pickPatch(req.body, ['name', 'description', 'kind', 'archived', 'sort_order']);
    const values = {};
    if ('name' in patch) values.name = requiredText(patch.name, 'název', 200);
    if ('description' in patch) values.description = optionalText(patch.description, 'popis', 20000);
    if ('kind' in patch) values.kind = oneOf(patch.kind, PROJECT_KINDS, 'druh projektu');
    if ('archived' in patch) values.archived = bool(patch.archived, 'archivace');
    if ('sort_order' in patch) values.sort_order = int(patch.sort_order, 'pořadí');

    // Názvy sloupců pocházejí z pevného seznamu výše, hodnoty jdou jako parametry.
    const cols = Object.keys(values);
    const sets = cols.map((c, i) => `${c} = $${i + 3}`);
    const { rows } = await pool.query(
      `UPDATE projects SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING ${PROJECT_COLUMNS}`,
      [id, req.session.userId, ...cols.map((c) => values[c])],
    );
    if (!rows[0]) {
      await getOwnedProject(pool, req.session.userId, id); // vyhodí 404
      throw badRequest('Projekt se nepodařilo upravit.');
    }
    res.json(rows[0]);
  });

  // Smaže projekt, jeho úkoly a navázané záznamy (CASCADE) a soubory příloh z disku.
  router.delete('/projects/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const storedNames = await withTransaction(pool, async (db) => {
      await getOwnedProject(db, req.session.userId, id);
      const names = await storedNamesForProject(db, id);
      await db.query('DELETE FROM projects WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
      return names;
    });
    await removeStoredFiles(config.uploadDir, storedNames);
    res.status(204).end();
  });

  return router;
}
