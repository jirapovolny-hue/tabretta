import express from 'express';
import { createAuthRouter, requireAuth } from './auth.js';
import { createProjectsRouter } from './projects.js';
import { createTasksRouter } from './tasks.js';
import { createItemsRouter } from './items.js';
import { createAttachmentsRouter } from './attachments.js';

/** Celé JSON API. Kromě /login a /logout vše jen pro přihlášeného uživatele. */
export function createApiRouter({ pool, config, loginLimit }) {
  const router = express.Router();
  router.use(createAuthRouter({ pool, loginLimit }));
  router.use(requireAuth);
  router.use(createProjectsRouter({ pool, config }));
  router.use(createTasksRouter({ pool, config }));
  router.use(createItemsRouter({ pool }));
  router.use(createAttachmentsRouter({ pool, config }));
  return router;
}
