import { Router } from 'express';
import multer from 'multer';
import { resolve, basename } from 'node:path';
import { createReadStream } from 'node:fs';

import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';

export const documentsRouter = Router();

const uploadDir = process.env.UPLOAD_DIR || './uploads';
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, resolve(uploadDir)),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`;
    cb(null, safe);
  },
});
const upload = multer({ storage });

documentsRouter.get(
  '/',
  authenticate,
  authorize({
    resource: 'documents',
    action: 'read',
    getOwnerId: (req) => req.query.customerId || req.auth.userId,
  }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const customerId = req.query.customerId || req.auth.userId;
      const applicationId = req.query.applicationId || null;

      if (customerId !== req.auth.userId && req.auth.role === 'customer') {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      const conditions = ['customer_id = :customer_id'];
      const params = { customer_id: customerId };
      if (applicationId) {
        conditions.push('application_id = :application_id');
        params.application_id = applicationId;
      }

      const [rows] = await pool.execute(
        `SELECT * FROM customer_documents WHERE ${conditions.join(' AND ')} ORDER BY uploaded_at DESC`,
        params,
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

documentsRouter.post(
  '/',
  authenticate,
  authorize({
    resource: 'documents',
    action: 'update',
    getOwnerId: (req) => req.body.customerId || req.auth.userId,
  }),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        const e = new Error('Missing file');
        e.status = 400;
        throw e;
      }

      const docId = newId();
      const pool = getPool();

      const customerId = req.body.customerId || req.auth.userId;
      const applicationId = req.body.applicationId || null;
      const documentType = req.body.documentType || null;

      const filePath = file.path;
      const documentUrl = `/documents/${docId}/download`;

      await pool.execute(
        `INSERT INTO customer_documents
         (id, customer_id, application_id, document_type, document_name, file_path, document_url, file_size, mime_type, status, uploaded_by, uploaded_at)
         VALUES
         (:id, :customer_id, :application_id, :document_type, :document_name, :file_path, :document_url, :file_size, :mime_type, 'pending', :uploaded_by, :uploaded_at)`,
        {
          id: docId,
          customer_id: customerId,
          application_id: applicationId,
          document_type: documentType,
          document_name: file.originalname,
          file_path: filePath,
          document_url: documentUrl,
          file_size: file.size,
          mime_type: file.mimetype,
          uploaded_by: req.auth.userId,
          uploaded_at: new Date(),
        },
      );

      const [[doc]] = await pool.execute(`SELECT * FROM customer_documents WHERE id = :id`, { id: docId });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  },
);

documentsRouter.get(
  '/:id/download',
  authenticate,
  authorize({
    resource: 'documents',
    action: 'read',
    getOwnerId: async (req) => {
      const pool = getPool();
      const [[doc]] = await pool.execute(
        `SELECT customer_id FROM customer_documents WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      return doc?.customer_id;
    },
  }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [[doc]] = await pool.execute(`SELECT * FROM customer_documents WHERE id = :id LIMIT 1`, {
        id: req.params.id,
      });
      if (!doc) return res.status(404).json({ error: 'Document not found' });

      const filename = basename(doc.file_path) || 'document';
      res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      createReadStream(doc.file_path).pipe(res);
    } catch (err) {
      next(err);
    }
  },
);

documentsRouter.delete(
  '/:id',
  authenticate,
  authorize({
    resource: 'documents',
    action: 'update',
    getOwnerId: async (req) => {
      const pool = getPool();
      const [[doc]] = await pool.execute(
        `SELECT customer_id FROM customer_documents WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      return doc?.customer_id;
    },
  }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.execute(`DELETE FROM customer_documents WHERE id = :id`, { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

