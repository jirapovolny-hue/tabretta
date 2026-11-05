import express from 'express';
import { getOwnedTask } from '../db/access.js';
import { normalizeHttpUrl } from '../validate.js';
import { badRequest, bool, decimal, notFound, nullableText, parseId, pickPatch, requiredText } from '../http.js';

// Odkazy a položky nákupního seznamu úkolu. Vlastnictví se ověřuje přes úkol → projekt → uživatel.

export function createItemsRouter({ pool }) {
  const router = express.Router();

  // --- Odkazy ---

  router.post('/tasks/:id/links', async (req, res) => {
    const taskId = parseId(req.params.id);
    const url = normalizeHttpUrl(req.body?.url);
    if (!url) throw badRequest('Odkaz musí být úplná adresa začínající http:// nebo https://.');
    const label = nullableText(req.body?.label, 'popisek', 200);
    await getOwnedTask(pool, req.session.userId, taskId);
    const { rows } = await pool.query(
      'INSERT INTO task_links (task_id, url, label) VALUES ($1, $2, $3) RETURNING id, url, label',
      [taskId, url, label],
    );
    res.status(201).json(rows[0]);
  });

  router.delete('/links/:id', async (req, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM task_links l USING tasks t, projects p
        WHERE l.id = $1 AND t.id = l.task_id AND p.id = t.project_id AND p.user_id = $2`,
      [parseId(req.params.id), req.session.userId],
    );
    if (!rowCount) throw notFound('Odkaz nenalezen.');
    res.status(204).end();
  });

  // --- Nákupní seznam ---

  const ITEM_COLUMNS = 'id, name, quantity, unit_price, bought, sort_order';
  const quantity = (v) => decimal(v, 'množství', { min: 0, exclusiveMin: true, places: 3 });
  const unitPrice = (v) => decimal(v, 'ceny', { nullable: true, places: 2 });

  router.post('/tasks/:id/shopping-items', async (req, res) => {
    const taskId = parseId(req.params.id);
    const body = req.body ?? {};
    const name = requiredText(body.name, 'název', 200);
    const qty = body.quantity === undefined ? 1 : quantity(body.quantity);
    const price = body.unit_price === undefined ? null : unitPrice(body.unit_price);
    await getOwnedTask(pool, req.session.userId, taskId);
    const { rows } = await pool.query(
      `INSERT INTO shopping_items (task_id, name, quantity, unit_price, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM shopping_items WHERE task_id = $1))
       RETURNING ${ITEM_COLUMNS}`,
      [taskId, name, qty, price],
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/shopping-items/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const patch = pickPatch(req.body, ['name', 'quantity', 'unit_price', 'bought']);
    const values = {};
    if ('name' in patch) values.name = requiredText(patch.name, 'název', 200);
    if ('quantity' in patch) values.quantity = quantity(patch.quantity);
    if ('unit_price' in patch) values.unit_price = unitPrice(patch.unit_price);
    if ('bought' in patch) values.bought = bool(patch.bought, 'koupeno');
    const cols = Object.keys(values);
    const sets = cols.map((c, i) => `${c} = $${i + 3}`);
    const { rows } = await pool.query(
      `UPDATE shopping_items s SET ${sets.join(', ')}
         FROM tasks t, projects p
        WHERE s.id = $1 AND t.id = s.task_id AND p.id = t.project_id AND p.user_id = $2
        RETURNING s.id, s.name, s.quantity, s.unit_price, s.bought, s.sort_order`,
      [id, req.session.userId, ...cols.map((c) => values[c])],
    );
    if (!rows[0]) throw notFound('Položka nenalezena.');
    res.json(rows[0]);
  });

  router.delete('/shopping-items/:id', async (req, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM shopping_items s USING tasks t, projects p
        WHERE s.id = $1 AND t.id = s.task_id AND p.id = t.project_id AND p.user_id = $2`,
      [parseId(req.params.id), req.session.userId],
    );
    if (!rowCount) throw notFound('Položka nenalezena.');
    res.status(204).end();
  });

  return router;
}
