import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { ensureMilestone3Schema } from '../db/ensureMilestone3Schema.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const interestMatrixRouter = Router();

const CSV_HEADERS = [
  'bank_name',
  'product_type',
  'loan_type',
  'credit_score_min',
  'credit_score_max',
  'loan_amount_min',
  'loan_amount_max',
  'term_min',
  'term_max',
  'interest_rate',
  'status',
  'effective_date',
  'change_note',
];
const REQUIRED_CSV_HEADERS = CSV_HEADERS.filter((header) => header !== 'bank_name');

function mapRow(row) {
  return {
    id: row.id,
    bankId: row.bank_id || null,
    bankName: row.bank_name || null,
    productType: row.product_type,
    loanType: row.loan_type,
    creditScoreMin: row.credit_score_min,
    creditScoreMax: row.credit_score_max,
    loanAmountMin: Number(row.loan_amount_min),
    loanAmountMax: Number(row.loan_amount_max),
    termMin: row.term_min,
    termMax: row.term_max,
    interestRate: Number(row.interest_rate),
    status: row.status,
    effectiveDate: row.effective_date
      ? new Date(row.effective_date).toISOString().slice(0, 10)
      : null,
    changeNote: row.change_note,
    modifiedBy: row.modified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeCsv(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function rowFromCsvValues(values, headerIndex) {
  const get = (name) => values[headerIndex[name]] ?? '';
  return {
    bank_name: get('bank_name') || '',
    product_type: get('product_type'),
    loan_type: get('loan_type') || 'Unsecured',
    credit_score_min: parseInt(get('credit_score_min'), 10) || 0,
    credit_score_max: parseInt(get('credit_score_max'), 10) || 900,
    loan_amount_min: parseFloat(get('loan_amount_min')) || 0,
    loan_amount_max: parseFloat(get('loan_amount_max')) || 0,
    term_min: parseInt(get('term_min'), 10) || 0,
    term_max: parseInt(get('term_max'), 10) || 0,
    interest_rate: parseFloat(get('interest_rate')) || 0,
    status: get('status') || 'active',
    effective_date: get('effective_date') || null,
    change_note: get('change_note') || null,
  };
}

interestMatrixRouter.get(
  '/',
  authenticate,
  authorize({ resource: 'interest_matrix', action: 'read' }),
  async (req, res, next) => {
    try {
      await ensureMilestone3Schema();
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT r.*, b.name AS bank_name
         FROM interest_matrix_rates r
         LEFT JOIN banks b ON b.id = r.bank_id
         ORDER BY b.name ASC, r.product_type, r.credit_score_min`,
      );
      res.json(rows.map(mapRow));
    } catch (err) {
      next(err);
    }
  },
);

interestMatrixRouter.get(
  '/export.csv',
  authenticate,
  authorize({ resource: 'interest_matrix', action: 'read' }),
  async (req, res, next) => {
    try {
      await ensureMilestone3Schema();
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT r.*, b.name AS bank_name
         FROM interest_matrix_rates r
         LEFT JOIN banks b ON b.id = r.bank_id
         ORDER BY b.name ASC, r.product_type`,
      );

      const lines = [CSV_HEADERS.join(',')];
      for (const row of rows) {
        lines.push(
          CSV_HEADERS.map((h) => {
            if (h === 'effective_date' && row.effective_date) {
              return escapeCsv(new Date(row.effective_date).toISOString().slice(0, 10));
            }
            return escapeCsv(row[h]);
          }).join(','),
        );
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="interest-matrix.csv"');
      res.send(lines.join('\n'));
    } catch (err) {
      next(err);
    }
  },
);

const BulkCsvSchema = z.object({
  csv: z.string().min(1),
  replaceAll: z.boolean().optional(),
});

const RateSchema = z.object({
  bankId: z.string().optional().nullable(),
  productType: z.string().min(1),
  loanType: z.string().optional(),
  creditScoreMin: z.coerce.number().optional(),
  creditScoreMax: z.coerce.number().optional(),
  loanAmountMin: z.coerce.number().optional(),
  loanAmountMax: z.coerce.number().optional(),
  termMin: z.coerce.number().optional(),
  termMax: z.coerce.number().optional(),
  interestRate: z.coerce.number(),
  status: z.string().optional(),
  effectiveDate: z.string().optional().nullable(),
  changeNote: z.string().optional().nullable(),
});

function bodyToRow(input, userId) {
  return {
    bank_id: input.bankId || null,
    product_type: input.productType,
    loan_type: input.loanType || 'Unsecured',
    credit_score_min: input.creditScoreMin ?? 0,
    credit_score_max: input.creditScoreMax ?? 900,
    loan_amount_min: input.loanAmountMin ?? 0,
    loan_amount_max: input.loanAmountMax ?? 0,
    term_min: input.termMin ?? 0,
    term_max: input.termMax ?? 0,
    interest_rate: input.interestRate,
    status: input.status || 'active',
    effective_date: input.effectiveDate || null,
    change_note: input.changeNote || null,
    modified_by: userId,
  };
}

interestMatrixRouter.post(
  '/',
  authenticate,
  authorize({ resource: 'interest_matrix', action: 'manage' }),
  async (req, res, next) => {
    try {
      await ensureMilestone3Schema();
      const input = RateSchema.parse(req.body);
      const pool = getPool();
      const id = newId();
      const row = bodyToRow(input, req.auth.userId);

      await pool.execute(
        `INSERT INTO interest_matrix_rates (
           id, bank_id, product_type, loan_type, credit_score_min, credit_score_max,
           loan_amount_min, loan_amount_max, term_min, term_max, interest_rate,
           status, effective_date, change_note, modified_by
         ) VALUES (
           :id, :bank_id, :product_type, :loan_type, :credit_score_min, :credit_score_max,
           :loan_amount_min, :loan_amount_max, :term_min, :term_max, :interest_rate,
           :status, :effective_date, :change_note, :modified_by
         )`,
        { id, ...row },
      );

      const [[saved]] = await pool.execute(`SELECT * FROM interest_matrix_rates WHERE id = :id`, { id });
      res.status(201).json(mapRow(saved));
    } catch (err) {
      next(err);
    }
  },
);

interestMatrixRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'interest_matrix', action: 'manage' }),
  async (req, res, next) => {
    try {
      await ensureMilestone3Schema();
      const input = RateSchema.parse(req.body);
      const pool = getPool();
      const row = bodyToRow(input, req.auth.userId);

      const [[existing]] = await pool.execute(
        `SELECT id FROM interest_matrix_rates WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      if (!existing) return res.status(404).json({ error: 'Rate not found' });

      await pool.execute(
        `UPDATE interest_matrix_rates SET
           bank_id = :bank_id,
           product_type = :product_type,
           loan_type = :loan_type,
           credit_score_min = :credit_score_min,
           credit_score_max = :credit_score_max,
           loan_amount_min = :loan_amount_min,
           loan_amount_max = :loan_amount_max,
           term_min = :term_min,
           term_max = :term_max,
           interest_rate = :interest_rate,
           status = :status,
           effective_date = :effective_date,
           change_note = :change_note,
           modified_by = :modified_by
         WHERE id = :id`,
        { id: req.params.id, ...row },
      );

      const [[saved]] = await pool.execute(`SELECT * FROM interest_matrix_rates WHERE id = :id`, {
        id: req.params.id,
      });
      res.json(mapRow(saved));
    } catch (err) {
      next(err);
    }
  },
);

interestMatrixRouter.delete(
  '/:id',
  authenticate,
  authorize({ resource: 'interest_matrix', action: 'manage' }),
  async (req, res, next) => {
    try {
      await ensureMilestone3Schema();
      const pool = getPool();
      const [result] = await pool.execute(`DELETE FROM interest_matrix_rates WHERE id = :id`, {
        id: req.params.id,
      });
      if (!result.affectedRows) return res.status(404).json({ error: 'Rate not found' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

interestMatrixRouter.post(
  '/import.csv',
  authenticate,
  authorize({ resource: 'interest_matrix', action: 'manage' }),
  async (req, res, next) => {
    try {
      await ensureMilestone3Schema();
      const input = BulkCsvSchema.parse(req.body);
      const lines = input.csv.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        const e = new Error('CSV must include a header row and at least one data row');
        e.status = 400;
        throw e;
      }

      const headerCells = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
      const headerIndex = {};
      headerCells.forEach((h, i) => {
        headerIndex[h] = i;
      });

      const missing = REQUIRED_CSV_HEADERS.filter((h) => headerIndex[h] === undefined);
      if (missing.length) {
        const e = new Error(`Missing CSV columns: ${missing.join(', ')}`);
        e.status = 400;
        throw e;
      }

      const pool = getPool();
      const conn = await pool.getConnection();
      let imported = 0;
      const [bankRows] = await conn.execute(`SELECT id, name FROM banks`);
      const bankIdByName = new Map(
        (bankRows || []).map((bank) => [String(bank.name || '').trim().toLowerCase(), bank.id]),
      );

      try {
        await conn.beginTransaction();
        if (input.replaceAll) {
          await conn.execute(`DELETE FROM interest_matrix_rates`);
        }

        for (let i = 1; i < lines.length; i += 1) {
          const values = parseCsvLine(lines[i]);
          if (!values.some(Boolean)) continue;
          const row = rowFromCsvValues(values, headerIndex);
          if (!row.product_type || !row.interest_rate) continue;

          await conn.execute(
            `INSERT INTO interest_matrix_rates (
               id, bank_id, product_type, loan_type, credit_score_min, credit_score_max,
               loan_amount_min, loan_amount_max, term_min, term_max, interest_rate,
               status, effective_date, change_note, modified_by
             ) VALUES (
               :id, :bank_id, :product_type, :loan_type, :credit_score_min, :credit_score_max,
               :loan_amount_min, :loan_amount_max, :term_min, :term_max, :interest_rate,
               :status, :effective_date, :change_note, :modified_by
             )`,
            {
              id: newId(),
              bank_id: bankIdByName.get(String(row.bank_name || '').trim().toLowerCase()) || null,
              ...row,
              effective_date: row.effective_date || null,
              modified_by: req.auth.userId,
            },
          );
          imported += 1;
        }

        await conn.commit();
        res.json({ imported, replaceAll: Boolean(input.replaceAll) });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } catch (err) {
      next(err);
    }
  },
);
