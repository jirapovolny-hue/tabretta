import fs from 'node:fs';
import fsp from 'node:fs/promises';
import express from 'express';
import multer from 'multer';
import { getOwnedTask } from '../db/access.js';
import {
  MAX_ATTACHMENT_BYTES,
  generateStoredName,
  sanitizeOriginalName,
  setDownloadHeaders,
} from '../attachments.js';
import { removeStoredFiles, storedPath } from '../files.js';
import { HttpError, badRequest, notFound, parseId } from '../http.js';

// Přílohy: soubory se ukládají jen do UPLOAD_DIR pod vygenerovaným názvem,
// původní název je jen v DB. Obsah souborů aplikace nikdy nezpracovává ani nespouští.

export function createAttachmentsRouter({ pool, config }) {
  const router = express.Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (req, file, cb) => cb(null, generateStoredName()),
    }),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0, parts: 1, headerPairs: 50 },
    defParamCharset: 'utf8', // české názvy souborů bez rozbité diakritiky
  }).single('file');

  function uploadMiddleware(req, res, next) {
    upload(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'Soubor je větší než 25 MB.'));
        return next(badRequest('Neplatné nahrání souboru (posílejte jeden soubor v poli „file“).'));
      }
      next(err);
    });
  }

  router.post(
    '/tasks/:id/attachments',
    // Vlastnictví úkolu se ověří dřív, než se cokoli zapíše na disk.
    async (req, res, next) => {
      req.taskId = parseId(req.params.id);
      await getOwnedTask(pool, req.session.userId, req.taskId);
      next();
    },
    uploadMiddleware,
    async (req, res) => {
      const file = req.file;
      if (!file) throw badRequest('Chybí soubor.');
      try {
        const { rows } = await pool.query(
          `INSERT INTO task_attachments (task_id, original_name, stored_name, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, original_name, mime_type, size_bytes, created_at`,
          [req.taskId, sanitizeOriginalName(file.originalname), file.filename, String(file.mimetype || '').slice(0, 200), file.size],
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        await removeStoredFiles(config.uploadDir, [file.filename]);
        if (err.code === '23503') throw notFound('Úkol nenalezen.'); // úkol mezitím smazán
        throw err;
      }
    },
  );

  async function getOwnedAttachment(id, userId) {
    const { rows } = await pool.query(
      `SELECT a.id, a.original_name, a.stored_name, a.mime_type, a.size_bytes
         FROM task_attachments a JOIN tasks t ON t.id = a.task_id JOIN projects p ON p.id = t.project_id
        WHERE a.id = $1 AND p.user_id = $2`,
      [id, userId],
    );
    if (!rows[0]) throw notFound('Příloha nenalezena.');
    return rows[0];
  }

  router.get('/attachments/:id', async (req, res) => {
    const a = await getOwnedAttachment(parseId(req.params.id), req.session.userId);
    const filePath = storedPath(config.uploadDir, a.stored_name);
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      throw notFound('Soubor přílohy chybí.');
    }
    setDownloadHeaders(res, { originalName: a.original_name, mimeType: a.mime_type, sizeBytes: stat.size });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => res.destroy(err));
    stream.pipe(res);
  });

  router.delete('/attachments/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const { rows } = await pool.query(
      `DELETE FROM task_attachments a USING tasks t, projects p
        WHERE a.id = $1 AND t.id = a.task_id AND p.id = t.project_id AND p.user_id = $2
        RETURNING a.stored_name`,
      [id, req.session.userId],
    );
    if (!rows[0]) throw notFound('Příloha nenalezena.');
    await removeStoredFiles(config.uploadDir, [rows[0].stored_name]);
    res.status(204).end();
  });

  return router;
}
