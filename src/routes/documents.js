import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { resolve, basename } from 'node:path';
import { createReadStream } from 'node:fs';

import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { hasPermission } from '../auth/permissions.js';
import { getPool } from '../db/pool.js';
import { ensureDocumentSchema } from '../db/ensureDocumentSchema.js';
import { newId } from '../lib/ids.js';
import { writeAuditLog } from '../lib/audit.js';

export const documentsRouter = Router();

const STAFF_ROLES = new Set(['admin', 'super_admin', 'employee']);

function isStaffRole(role) {
  return STAFF_ROLES.has(role) || hasPermission(role, 'read:*');
}

function normalizeDocStatus(row) {
  const raw = row?.verification_status || row?.status || 'pending';
  const s = String(raw).toLowerCase();
  if (s === 'verified') return 'approved';
  if (['approved', 'rejected', 'pending', 'uploaded', 'expired'].includes(s)) return s;
  return 'pending';
}

function formatDocumentRow(row) {
  const fileName = basename(row.file_path);
  const isImage = (row.mime_type || '').startsWith('image/');
  const previewUrl = isImage && fileName ? `/uploads/${fileName}` : null;
  const verificationStatus = normalizeDocStatus(row);
  return {
    ...row,
    verification_status: verificationStatus,
    status: verificationStatus,
    preview_url: previewUrl,
  };
}

function summarizeApplicationDocStatus(counts) {
  const total = Number(counts.total_docs) || 0;
  if (total === 0) return 'no_documents';
  const pending = Number(counts.pending_docs) || 0;
  const rejected = Number(counts.rejected_docs) || 0;
  const approved = Number(counts.approved_docs) || 0;
  if (rejected > 0) return 'has_rejected';
  if (pending > 0) return 'pending_review';
  if (approved === total) return 'all_approved';
  return 'in_review';
}

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
  '/applications',
  authenticate,
  authorize({ resource: 'documents', action: 'read' }),
  async (req, res, next) => {
    try {
      if (!isStaffRole(req.auth.role)) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      await ensureDocumentSchema();
      const pool = getPool();
      const search = req.query.search?.trim();
      const statusFilter = req.query.documentStatus?.trim();

      let having = '';
      const params = {};
      if (statusFilter && statusFilter !== 'all') {
        having = 'HAVING document_summary_status = :doc_status';
        params.doc_status = statusFilter;
      }

      let searchClause = '';
      if (search) {
        searchClause = `AND (
          la.application_number LIKE :search
          OR up.full_name LIKE :search
          OR up.email LIKE :search
          OR up.phone LIKE :search
        )`;
        params.search = `%${search}%`;
      }

      const [rows] = await pool.execute(
        `SELECT
           la.id AS application_id,
           la.application_number,
           la.status AS application_status,
           la.created_at AS application_created_at,
           up.full_name AS customer_name,
           up.email AS customer_email,
           up.phone AS customer_phone,
           COUNT(cd.id) AS total_docs,
           SUM(CASE WHEN COALESCE(cd.verification_status, cd.status, 'pending') IN ('pending','uploaded') THEN 1 ELSE 0 END) AS pending_docs,
           SUM(CASE WHEN COALESCE(cd.verification_status, cd.status, 'pending') IN ('approved','verified') THEN 1 ELSE 0 END) AS approved_docs,
           SUM(CASE WHEN COALESCE(cd.verification_status, cd.status, 'pending') = 'rejected' THEN 1 ELSE 0 END) AS rejected_docs,
           CASE
             WHEN COUNT(cd.id) = 0 THEN 'no_documents'
             WHEN SUM(CASE WHEN COALESCE(cd.verification_status, cd.status, 'pending') = 'rejected' THEN 1 ELSE 0 END) > 0 THEN 'has_rejected'
             WHEN SUM(CASE WHEN COALESCE(cd.verification_status, cd.status, 'pending') IN ('pending','uploaded') THEN 1 ELSE 0 END) > 0 THEN 'pending_review'
             WHEN SUM(CASE WHEN COALESCE(cd.verification_status, cd.status, 'pending') IN ('approved','verified') THEN 1 ELSE 0 END) = COUNT(cd.id) THEN 'all_approved'
             ELSE 'in_review'
           END AS document_summary_status
         FROM loan_applications la
         LEFT JOIN user_profiles up ON up.id = la.customer_id
         LEFT JOIN customer_documents cd ON cd.application_id = la.id
         WHERE 1=1 ${searchClause}
         GROUP BY la.id, la.application_number, la.status, la.created_at,
                  up.full_name, up.email, up.phone
         ${having}
         ORDER BY la.created_at DESC`,
        params,
      );

      res.json(
        rows.map((row) => ({
          application_id: row.application_id,
          application_number: row.application_number,
          application_status: row.application_status,
          application_created_at: row.application_created_at,
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          customer_phone: row.customer_phone,
          total_docs: Number(row.total_docs) || 0,
          pending_docs: Number(row.pending_docs) || 0,
          approved_docs: Number(row.approved_docs) || 0,
          rejected_docs: Number(row.rejected_docs) || 0,
          document_summary_status: row.document_summary_status || summarizeApplicationDocStatus(row),
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

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
      await ensureDocumentSchema();
      const pool = getPool();
      const applicationId = req.query.applicationId || null;
      const customerId = req.query.customerId || null;
      const isStaff = isStaffRole(req.auth.role);

      let conditions = [];
      const params = {};

      if (applicationId) {
        conditions.push('application_id = :application_id');
        params.application_id = applicationId;
        if (!isStaff && req.auth.role === 'customer') {
          conditions.push('customer_id = :customer_id');
          params.customer_id = req.auth.userId;
        }
      } else if (isStaff && customerId) {
        conditions.push('customer_id = :customer_id');
        params.customer_id = customerId;
      } else if (isStaff) {
        /* staff: all documents when no filter */
      } else {
        const ownerId = customerId || req.auth.userId;
        if (ownerId !== req.auth.userId && req.auth.role === 'customer') {
          const e = new Error('Insufficient permissions');
          e.status = 403;
          throw e;
        }
        conditions.push('customer_id = :customer_id');
        params.customer_id = ownerId;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows] = await pool.execute(
        `SELECT * FROM customer_documents ${where} ORDER BY uploaded_at DESC`,
        params,
      );
      res.json(rows.map(formatDocumentRow));
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
      res.status(201).json(formatDocumentRow(doc));
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

const VerifyDocumentSchema = z.object({
  status: z.enum(['pending', 'uploaded', 'approved', 'rejected']),
  verification_notes: z.string().optional(),
  verificationNotes: z.string().optional(),
});

documentsRouter.patch(
  '/:id/verification',
  authenticate,
  authorize({ resource: 'documents', action: 'update' }),
  async (req, res, next) => {
    try {
      if (!isStaffRole(req.auth.role)) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      await ensureDocumentSchema();
      const input = VerifyDocumentSchema.parse(req.body);
      const notes = input.verification_notes ?? input.verificationNotes ?? null;
      const pool = getPool();

      const [[existing]] = await pool.execute(
        `SELECT * FROM customer_documents WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      if (!existing) return res.status(404).json({ error: 'Document not found' });

      await pool.execute(
        `UPDATE customer_documents
         SET verification_status = :status,
             status = :status,
             verification_notes = :notes,
             verified_by = :verified_by,
             verified_at = NOW(3)
         WHERE id = :id`,
        {
          id: req.params.id,
          status: input.status,
          notes,
          verified_by: req.auth.userId,
        },
      );

      const [[row]] = await pool.execute(`SELECT * FROM customer_documents WHERE id = :id`, {
        id: req.params.id,
      });

      await writeAuditLog({
        userId: req.auth.userId,
        actionType: 'VERIFY',
        tableName: 'customer_documents',
        recordId: req.params.id,
        oldValues: {
          verification_status: existing.verification_status,
          status: existing.status,
        },
        newValues: {
          verification_status: input.status,
          verification_notes: notes,
          verified_at: new Date().toISOString(),
        },
      });

      res.json(formatDocumentRow(row));
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

