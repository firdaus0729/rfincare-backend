import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { ensureDocumentRequirementsSchema } from '../db/ensureDocumentRequirementsSchema.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { newId } from '../lib/ids.js';

export const documentRequirementsRouter = Router();

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeLoanType(rawLoanType, productType) {
  const value = String(rawLoanType || '').toLowerCase();
  if (value === 'secured' || value === 'unsecured') return value;
  const key = `${value} ${String(productType || '').toLowerCase()}`;
  if (
    key.includes('home')
    || key.includes('mortgage')
    || key.includes('property')
    || key.includes('auto')
    || key.includes('car')
    || key.includes('gold')
  ) {
    return 'secured';
  }
  return value ? 'unsecured' : null;
}

function normalizeAllowedTypes(value) {
  const list = Array.isArray(value) ? value : parseJson(value, []);
  const normalized = (list || [])
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)];
}

function slugifyDocumentType(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatRequirement(row) {
  return {
    id: row.id,
    bankId: row.bank_id || null,
    productType: row.product_type || null,
    loanType: row.loan_type || null,
    documentType: row.document_type,
    title: row.title,
    subtitle: row.subtitle || '',
    allowedFileTypes: normalizeAllowedTypes(row.allowed_file_types_json),
    isRequired: !!row.is_required,
    sortOrder: Number(row.sort_order) || 0,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RequirementSchema = z.object({
  bankId: z.string().nullable().optional(),
  productType: z.string().nullable().optional(),
  loanType: z.string().nullable().optional(),
  documentType: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable().optional(),
  allowedFileTypes: z.array(z.string()).optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.coerce.number().optional(),
  isActive: z.boolean().optional(),
});

async function resolveRequirements({ bankId, productType, loanType }) {
  await ensureDocumentRequirementsSchema();
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT *
     FROM document_requirements
     WHERE is_active = 1
       AND (bank_id = :bank_id OR bank_id IS NULL)
       AND (
         LOWER(CONVERT(COALESCE(product_type, '') USING utf8mb4)) COLLATE utf8mb4_unicode_ci
           = LOWER(CONVERT(COALESCE(:product_type, '') USING utf8mb4)) COLLATE utf8mb4_unicode_ci
         OR product_type IS NULL
         OR product_type = ''
       )
       AND (
         LOWER(CONVERT(COALESCE(loan_type, '') USING utf8mb4)) COLLATE utf8mb4_unicode_ci
           = LOWER(CONVERT(COALESCE(:loan_type, '') USING utf8mb4)) COLLATE utf8mb4_unicode_ci
         OR loan_type IS NULL
         OR loan_type = ''
       )
     ORDER BY
       CASE WHEN bank_id IS NULL THEN 1 ELSE 0 END ASC,
       CASE WHEN product_type IS NULL OR product_type = '' THEN 1 ELSE 0 END ASC,
       CASE WHEN loan_type IS NULL OR loan_type = '' THEN 1 ELSE 0 END ASC,
       sort_order ASC,
       created_at ASC`,
    {
      bank_id: bankId || null,
      product_type: productType || null,
      loan_type: loanType || null,
    },
  );

  const chosenByType = new Map();
  for (const row of rows) {
    const key = String(row.document_type || '').toLowerCase();
    if (!key || chosenByType.has(key)) continue;
    chosenByType.set(key, formatRequirement(row));
  }
  return Array.from(chosenByType.values());
}

documentRequirementsRouter.get(
  '/',
  authenticate,
  authorize({ resource: 'documents', action: 'read' }),
  async (req, res, next) => {
    try {
      await ensureDocumentRequirementsSchema();
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT *
         FROM document_requirements
         WHERE (:bank_id IS NULL OR bank_id = :bank_id)
           AND (
             :product_type IS NULL
             OR LOWER(CONVERT(COALESCE(product_type, '') USING utf8mb4)) COLLATE utf8mb4_unicode_ci
                = LOWER(CONVERT(:product_type USING utf8mb4)) COLLATE utf8mb4_unicode_ci
           )
           AND (
             :loan_type IS NULL
             OR LOWER(CONVERT(COALESCE(loan_type, '') USING utf8mb4)) COLLATE utf8mb4_unicode_ci
                = LOWER(CONVERT(:loan_type USING utf8mb4)) COLLATE utf8mb4_unicode_ci
           )
         ORDER BY sort_order ASC, created_at DESC`,
        {
          bank_id: req.query.bankId || null,
          product_type: req.query.productType || null,
          loan_type: req.query.loanType || null,
        },
      );
      res.json(rows.map(formatRequirement));
    } catch (err) {
      next(err);
    }
  },
);

documentRequirementsRouter.get(
  '/resolve',
  authenticate,
  authorize({ resource: 'documents', action: 'read' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      let bankId = req.query.bankId || null;
      let productType = req.query.productType || null;
      let loanType = req.query.loanType || null;
      const applicationId = req.query.applicationId || null;

      if (applicationId) {
        const [[app]] = await pool.execute(
          `SELECT selected_bank_id, data
           FROM loan_applications
           WHERE id = :id
           LIMIT 1`,
          { id: applicationId },
        );
        if (!app) return res.status(404).json({ error: 'Application not found' });
        const data = parseJson(app.data, {});
        bankId = bankId || app.selected_bank_id || data.preferred_bank_id || data.preferredBankId || null;
        productType =
          productType
          || data.loan_purpose
          || data.loanPurpose
          || data.loan_type
          || data.loanType
          || null;
        loanType = loanType || normalizeLoanType(data.loan_type || data.loanType, productType);
      } else {
        loanType = normalizeLoanType(loanType, productType);
      }

      const requirements = await resolveRequirements({ bankId, productType, loanType });
      res.json({ bankId, productType, loanType, requirements });
    } catch (err) {
      next(err);
    }
  },
);

documentRequirementsRouter.post(
  '/',
  authenticate,
  authorize({ resource: 'documents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureDocumentRequirementsSchema();
      const input = RequirementSchema.parse(req.body);
      const pool = getPool();
      const id = newId();
      await pool.execute(
        `INSERT INTO document_requirements (
           id, bank_id, product_type, loan_type, document_type, title, subtitle,
           allowed_file_types_json, is_required, sort_order, is_active, created_by
         ) VALUES (
           :id, :bank_id, :product_type, :loan_type, :document_type, :title, :subtitle,
           :allowed_file_types_json, :is_required, :sort_order, :is_active, :created_by
         )`,
        {
          id,
          bank_id: input.bankId || null,
          product_type: input.productType || null,
          loan_type: input.loanType || null,
          document_type: input.documentType,
          title: input.title,
          subtitle: input.subtitle || null,
          allowed_file_types_json: JSON.stringify(normalizeAllowedTypes(input.allowedFileTypes || [])),
          is_required: input.isRequired === false ? 0 : 1,
          sort_order: Number(input.sortOrder || 0),
          is_active: input.isActive === false ? 0 : 1,
          created_by: req.auth.userId,
        },
      );
      const [[row]] = await pool.execute(`SELECT * FROM document_requirements WHERE id = :id`, { id });
      res.status(201).json(formatRequirement(row));
    } catch (err) {
      next(err);
    }
  },
);

documentRequirementsRouter.get(
  '/export.csv',
  authenticate,
  authorize({ resource: 'documents', action: 'read' }),
  async (_req, res, next) => {
    try {
      await ensureDocumentRequirementsSchema();
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT dr.*, b.name AS bank_name
         FROM document_requirements dr
         LEFT JOIN banks b ON b.id = dr.bank_id
         ORDER BY
           COALESCE(b.name, ''),
           COALESCE(dr.product_type, ''),
           COALESCE(dr.loan_type, ''),
           dr.sort_order ASC,
           dr.created_at ASC`,
      );

      const grouped = new Map();
      for (const row of rows) {
        const groupKey = [
          row.bank_name || '',
          row.product_type || '',
          row.loan_type || '',
        ].join('||');
        if (!grouped.has(groupKey)) grouped.set(groupKey, []);
        grouped.get(groupKey).push(row);
      }

      const header = ['Bank_Name', 'product_type', 'loan_type', 'Documents needed'];
      const lines = [header.join(',')];
      for (const docs of grouped.values()) {
        const first = docs[0];
        const documentTitles = docs
          .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
          .map((item) => item.title || item.document_type)
          .filter(Boolean);
        const row = [
          first.bank_name || '',
          first.product_type || '',
          first.loan_type || '',
          ...documentTitles,
        ];
        lines.push(row.map((cell) => escapeCsv(cell)).join(','));
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="document-requirements.csv"');
      res.send(lines.join('\n'));
    } catch (err) {
      next(err);
    }
  },
);

const RequirementPatchSchema = RequirementSchema.partial();

const ImportCsvSchema = z.object({
  csv: z.string().min(1),
  replaceAll: z.boolean().optional(),
});

documentRequirementsRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'documents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureDocumentRequirementsSchema();
      const patch = RequirementPatchSchema.parse(req.body);
      const pool = getPool();
      const [[existing]] = await pool.execute(`SELECT * FROM document_requirements WHERE id = :id LIMIT 1`, {
        id: req.params.id,
      });
      if (!existing) return res.status(404).json({ error: 'Document requirement not found' });

      const merged = {
        ...formatRequirement(existing),
        ...patch,
      };
      await pool.execute(
        `UPDATE document_requirements SET
           bank_id = :bank_id,
           product_type = :product_type,
           loan_type = :loan_type,
           document_type = :document_type,
           title = :title,
           subtitle = :subtitle,
           allowed_file_types_json = :allowed_file_types_json,
           is_required = :is_required,
           sort_order = :sort_order,
           is_active = :is_active
         WHERE id = :id`,
        {
          id: req.params.id,
          bank_id: merged.bankId || null,
          product_type: merged.productType || null,
          loan_type: merged.loanType || null,
          document_type: merged.documentType,
          title: merged.title,
          subtitle: merged.subtitle || null,
          allowed_file_types_json: JSON.stringify(normalizeAllowedTypes(merged.allowedFileTypes || [])),
          is_required: merged.isRequired === false ? 0 : 1,
          sort_order: Number(merged.sortOrder || 0),
          is_active: merged.isActive === false ? 0 : 1,
        },
      );
      const [[row]] = await pool.execute(`SELECT * FROM document_requirements WHERE id = :id`, {
        id: req.params.id,
      });
      res.json(formatRequirement(row));
    } catch (err) {
      next(err);
    }
  },
);

documentRequirementsRouter.delete(
  '/:id',
  authenticate,
  authorize({ resource: 'documents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureDocumentRequirementsSchema();
      const pool = getPool();
      await pool.execute(`DELETE FROM document_requirements WHERE id = :id`, { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

documentRequirementsRouter.post(
  '/import.csv',
  authenticate,
  authorize({ resource: 'documents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureDocumentRequirementsSchema();
      const input = ImportCsvSchema.parse(req.body);
      const lines = input.csv.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        return res.status(400).json({ error: 'CSV must include header and at least one row' });
      }

      const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
      const bankIdx = headers.findIndex((h) => h === 'bank_name' || h === 'bank');
      const productIdx = headers.findIndex((h) => h === 'product_type' || h === 'product');
      const loanTypeIdx = headers.findIndex((h) => h === 'loan_type' || h === 'type_of_loan');
      const docsStartIdx = headers.findIndex((h) => h.includes('documents needed') || h === 'document_1');

      if (productIdx < 0 || loanTypeIdx < 0 || docsStartIdx < 0) {
        return res.status(400).json({
          error:
            'CSV must include product_type, loan_type, and Documents needed columns.',
        });
      }

      const pool = getPool();
      const conn = await pool.getConnection();
      let imported = 0;

      try {
        await conn.beginTransaction();

        if (input.replaceAll) {
          await conn.execute(`DELETE FROM document_requirements`);
        }

        const [bankRows] = await conn.execute(`SELECT id, name FROM banks`);
        const bankIdByName = new Map(
          (bankRows || []).map((row) => [String(row.name || '').trim().toLowerCase(), row.id]),
        );

        for (let rowIdx = 1; rowIdx < lines.length; rowIdx += 1) {
          const cells = parseCsvLine(lines[rowIdx]);
          if (!cells.some(Boolean)) continue;

          const bankName = bankIdx >= 0 ? String(cells[bankIdx] || '').trim() : '';
          const productType = String(cells[productIdx] || '').trim();
          const loanType = String(cells[loanTypeIdx] || '').trim().toLowerCase();
          if (!productType) continue;

          const bankId = bankName ? bankIdByName.get(bankName.toLowerCase()) || null : null;

          let docOrder = 0;
          for (let i = docsStartIdx; i < cells.length; i += 1) {
            const rawDoc = String(cells[i] || '').trim();
            if (!rawDoc) continue;

            const isPhoto = /photo/i.test(rawDoc);
            const allowed = isPhoto ? ['jpeg', 'png', 'webp'] : ['jpeg', 'png', 'pdf'];

            await conn.execute(
              `INSERT INTO document_requirements (
                 id, bank_id, product_type, loan_type, document_type, title, subtitle,
                 allowed_file_types_json, is_required, sort_order, is_active, created_by
               ) VALUES (
                 :id, :bank_id, :product_type, :loan_type, :document_type, :title, :subtitle,
                 :allowed_file_types_json, 1, :sort_order, 1, :created_by
               )`,
              {
                id: newId(),
                bank_id: bankId,
                product_type: productType,
                loan_type: loanType || null,
                document_type: slugifyDocumentType(rawDoc),
                title: rawDoc,
                subtitle: null,
                allowed_file_types_json: JSON.stringify(allowed),
                sort_order: docOrder,
                created_by: req.auth.userId,
              },
            );
            docOrder += 1;
            imported += 1;
          }
        }

        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      res.json({ imported, replaceAll: Boolean(input.replaceAll) });
    } catch (err) {
      next(err);
    }
  },
);
