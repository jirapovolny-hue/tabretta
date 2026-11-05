import { notFound } from '../http.js';

// Každý přístup k datům jde přes vlastníka projektu. Cizí záznam se tváří
// jako neexistující (404), aby nešlo zjišťovat cizí id.

export async function getOwnedProject(db, userId, projectId) {
  const { rows } = await db.query(
    `SELECT id, name, description, kind, archived, sort_order, created_at, updated_at
       FROM projects WHERE id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  if (!rows[0]) throw notFound('Projekt nenalezen.');
  return rows[0];
}

export async function getOwnedTask(db, userId, taskId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT t.id, t.project_id, t.title, t.description, t.status, t.due_date, t.sort_order,
            t.completed_at, t.created_at, t.updated_at,
            p.name AS project_name, p.kind AS project_kind, p.archived AS project_archived
       FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.id = $1 AND p.user_id = $2
      ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [taskId, userId],
  );
  if (!rows[0]) throw notFound('Úkol nenalezen.');
  return rows[0];
}

/** Uložené názvy příloh všech úkolů projektu (pro smazání souborů z disku). */
export async function storedNamesForProject(db, projectId) {
  const { rows } = await db.query(
    `SELECT a.stored_name FROM task_attachments a JOIN tasks t ON t.id = a.task_id WHERE t.project_id = $1`,
    [projectId],
  );
  return rows.map((r) => r.stored_name);
}

export async function storedNamesForTask(db, taskId) {
  const { rows } = await db.query('SELECT stored_name FROM task_attachments WHERE task_id = $1', [taskId]);
  return rows.map((r) => r.stored_name);
}
