import express from 'express';
import { withTransaction } from '../db/pool.js';
import { getOwnedProject, getOwnedTask, storedNamesForTask } from '../db/access.js';
import { removeStoredFiles } from '../files.js';
import {
  PROJECT_KINDS,
  TASK_STATUSES,
  badRequest,
  int,
  nullableDate,
  oneOf,
  optionalText,
  parseId,
  pickPatch,
  requiredText,
} from '../http.js';

// Nedokončení předchůdci úkolu (štítek „čeká na“). Jen upozornění, nic neblokuje.
const WAITING_ON_SQL = `
  COALESCE((
    SELECT json_agg(json_build_object('id', d.id, 'title', d.title, 'status', d.status) ORDER BY d.id)
      FROM task_dependencies td JOIN tasks d ON d.id = td.depends_on_task_id
     WHERE td.task_id = t.id AND d.status <> 'hotovo'
  ), '[]'::json)`;

const TASK_LIST_COLUMNS = `
  t.id, t.project_id, t.title, t.status, t.due_date, t.sort_order, t.completed_at,
  t.created_at, t.updated_at, p.name AS project_name, p.kind AS project_kind`;

export function createTasksRouter({ pool, config }) {
  const router = express.Router();

  /**
   * Seznam úkolů napříč projekty uživatele.
   * ?project_id=  jen jeden projekt (i archivovaný)
   * ?kind=        prace | soukrome
   * ?status=      jen daný stav (např. rozdelane pro rychlý pohled)
   * ?include_done=1  zahrnout i hotové (jinak skryté, pokud není ?status)
   */
  router.get('/tasks', async (req, res) => {
    const projectId = req.query.project_id ? parseId(req.query.project_id, { status: 400, name: 'id projektu' }) : null;
    const kind = req.query.kind ? oneOf(req.query.kind, PROJECT_KINDS, 'druh projektu') : null;
    const status = req.query.status ? oneOf(req.query.status, TASK_STATUSES, 'stav') : null;
    const includeDone = req.query.include_done === '1' || status === 'hotovo';

    const { rows } = await pool.query(
      `SELECT ${TASK_LIST_COLUMNS}, ${WAITING_ON_SQL} AS waiting_on
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE p.user_id = $1
          AND (CASE WHEN $2::bigint IS NULL THEN NOT p.archived ELSE p.id = $2 END)
          AND ($3::text IS NULL OR p.kind = $3)
          AND ($4::text IS NULL OR t.status = $4)
          AND ($5::boolean OR t.status <> 'hotovo')
        ORDER BY p.sort_order, p.id, t.sort_order, t.id`,
      [req.session.userId, projectId, kind, status, includeDone],
    );
    res.json(rows);
  });

  router.post('/projects/:id/tasks', async (req, res) => {
    const projectId = parseId(req.params.id);
    const body = req.body ?? {};
    const title = requiredText(body.title, 'název', 500);
    const description = optionalText(body.description, 'popis', 50000);
    const status = body.status === undefined ? 'k_udelani' : oneOf(body.status, TASK_STATUSES, 'stav');
    const dueDate = nullableDate(body.due_date);
    await getOwnedProject(pool, req.session.userId, projectId);
    const { rows } = await pool.query(
      `INSERT INTO tasks (project_id, title, description, status, due_date, completed_at, sort_order)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'hotovo' THEN now() END,
               (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM tasks WHERE project_id = $1))
       RETURNING id`,
      [projectId, title, description, status, dueDate],
    );
    res.status(201).json(await taskDetail(pool, req.session.userId, rows[0].id));
  });

  router.get('/tasks/:id', async (req, res) => {
    res.json(await taskDetail(pool, req.session.userId, parseId(req.params.id)));
  });

  router.patch('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const patch = pickPatch(req.body, ['title', 'description', 'status', 'due_date', 'sort_order', 'project_id']);
    const values = {};
    if ('title' in patch) values.title = requiredText(patch.title, 'název', 500);
    if ('description' in patch) values.description = optionalText(patch.description, 'popis', 50000);
    if ('status' in patch) values.status = oneOf(patch.status, TASK_STATUSES, 'stav');
    if ('due_date' in patch) values.due_date = nullableDate(patch.due_date);
    if ('sort_order' in patch) values.sort_order = int(patch.sort_order, 'pořadí');
    if ('project_id' in patch) values.project_id = parseId(patch.project_id, { status: 400, name: 'id projektu' });

    await withTransaction(pool, async (db) => {
      const task = await getOwnedTask(db, req.session.userId, id, { forUpdate: true });
      if (values.project_id !== undefined && values.project_id !== task.project_id) {
        await getOwnedProject(db, req.session.userId, values.project_id).catch(() => {
          throw badRequest('Cílový projekt neexistuje.');
        });
      }
      const cols = Object.keys(values);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`);
      // completed_at: nastaví se při přechodu do Hotovo, smaže při odchodu z něj.
      let completed = '';
      if ('status' in values) {
        completed = values.status === 'hotovo'
          ? (task.status === 'hotovo' ? '' : ', completed_at = now()')
          : ', completed_at = NULL';
      }
      await db.query(
        `UPDATE tasks SET ${sets.join(', ')}${completed}, updated_at = now() WHERE id = $1`,
        [id, ...cols.map((c) => values[c])],
      );
    });
    res.json(await taskDetail(pool, req.session.userId, id));
  });

  router.delete('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const storedNames = await withTransaction(pool, async (db) => {
      await getOwnedTask(db, req.session.userId, id, { forUpdate: true });
      const names = await storedNamesForTask(db, id);
      await db.query('DELETE FROM tasks WHERE id = $1', [id]);
      return names;
    });
    await removeStoredFiles(config.uploadDir, storedNames);
    res.status(204).end();
  });

  // --- Navazuje na (závislosti) ---

  router.post('/tasks/:id/dependencies', async (req, res) => {
    const id = parseId(req.params.id);
    const dependsOn = parseId(req.body?.depends_on_task_id, { status: 400, name: 'id úkolu' });
    if (dependsOn === id) throw badRequest('Úkol nemůže navazovat sám na sebe.');
    await getOwnedTask(pool, req.session.userId, id);
    // Předchůdce smí být i v jiném projektu, ale vždy jen úkol téhož uživatele.
    await getOwnedTask(pool, req.session.userId, dependsOn).catch(() => {
      throw badRequest('Úkol, na který má navazovat, neexistuje.');
    });
    await pool.query(
      'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, dependsOn],
    );
    res.status(201).json(await taskDetail(pool, req.session.userId, id));
  });

  router.delete('/tasks/:id/dependencies/:dependsOnId', async (req, res) => {
    const id = parseId(req.params.id);
    const dependsOn = parseId(req.params.dependsOnId);
    await getOwnedTask(pool, req.session.userId, id);
    await pool.query('DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_task_id = $2', [id, dependsOn]);
    res.status(204).end();
  });

  return router;
}

/** Detail úkolu včetně odkazů, příloh, nákupního seznamu a závislostí. */
export async function taskDetail(db, userId, taskId) {
  const task = await getOwnedTask(db, userId, taskId);
  const [links, attachments, items, dependsOn, dependents] = await Promise.all([
    db.query('SELECT id, url, label FROM task_links WHERE task_id = $1 ORDER BY id', [taskId]),
    db.query(
      `SELECT id, original_name, mime_type, size_bytes, created_at
         FROM task_attachments WHERE task_id = $1 ORDER BY created_at, id`,
      [taskId],
    ),
    db.query(
      `SELECT id, name, quantity, unit_price, bought, sort_order
         FROM shopping_items WHERE task_id = $1 ORDER BY sort_order, id`,
      [taskId],
    ),
    db.query(
      `SELECT d.id, d.title, d.status, d.project_id, p.name AS project_name
         FROM task_dependencies td
         JOIN tasks d ON d.id = td.depends_on_task_id
         JOIN projects p ON p.id = d.project_id
        WHERE td.task_id = $1 AND p.user_id = $2
        ORDER BY d.id`,
      [taskId, userId],
    ),
    db.query(
      `SELECT s.id, s.title, s.status, s.project_id, p.name AS project_name
         FROM task_dependencies td
         JOIN tasks s ON s.id = td.task_id
         JOIN projects p ON p.id = s.project_id
        WHERE td.depends_on_task_id = $1 AND p.user_id = $2
        ORDER BY s.id`,
      [taskId, userId],
    ),
  ]);
  return {
    ...task,
    links: links.rows,
    attachments: attachments.rows,
    shopping_items: items.rows,
    shopping_totals: shoppingTotals(items.rows),
    depends_on: dependsOn.rows,
    dependents: dependents.rows,
    waiting_on: dependsOn.rows.filter((d) => d.status !== 'hotovo').map(({ id, title, status }) => ({ id, title, status })),
  };
}

/** Součty nákupního seznamu: celkem a zbývá koupit (jen položky s cenou). */
export function shoppingTotals(items) {
  let total = 0;
  let remaining = 0;
  let unpriced = 0;
  for (const it of items) {
    if (it.unit_price === null) {
      unpriced += 1;
      continue;
    }
    const line = Math.round(it.quantity * it.unit_price * 100);
    total += line;
    if (!it.bought) remaining += line;
  }
  return { total: total / 100, remaining: remaining / 100, unpriced_count: unpriced };
}
