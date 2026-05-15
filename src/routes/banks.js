import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { newId } from '../lib/ids.js';

export const banksRouter = Router();

const LOAN_TYPE_ALIASES = {
  personal: 'personal_loan',
  home: 'home_loan',
  business: 'business_loan',
  auto: 'auto_loan',
  education: 'education_loan',
  personal_loan: 'personal_loan',
  home_loan: 'home_loan',
  business_loan: 'business_loan',
  auto_loan: 'auto_loan',
  education_loan: 'education_loan',
};

function parseProductData(data) {
  if (!data) return {};
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function resolveProductLoanType(product) {
  const d = parseProductData(product.data);
  const explicit = d.loanType || d.loan_type || d.type || d.productType;
  if (explicit) return String(explicit).toLowerCase();
  const name = String(product.name || '').toLowerCase();
  if (name.includes('personal')) return 'personal_loan';
  if (name.includes('home')) return 'home_loan';
  if (name.includes('business')) return 'business_loan';
  if (name.includes('auto') || name.includes('car')) return 'auto_loan';
  if (name.includes('education')) return 'education_loan';
  return null;
}

function normalizeLoanTypeQuery(value) {
  if (!value) return null;
  const key = String(value).toLowerCase().replace(/-/g, '_');
  return LOAN_TYPE_ALIASES[key] || (key.endsWith('_loan') ? key : null);
}

const BankSchema = z.object({
  name: z.string().min(1),
  logo_url: z.string().url().optional().nullable(),
  logo_alt: z.string().optional().nullable(),
  status: z.string().optional(),
  display_priority: z.number().optional(),
});

banksRouter.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const includeProducts = req.query.includeProducts !== 'false';
    const loanTypeFilter = normalizeLoanTypeQuery(req.query.loanType);
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT * FROM banks ${includeInactive ? '' : "WHERE status = 'active'"} ORDER BY display_priority DESC`,
    );

    if (!includeProducts) {
      return res.json(rows);
    }

    const [products] = await pool.execute(
      `SELECT id, bank_id, name, is_active, data FROM bank_products WHERE is_active = 1`,
    );

    const productsByBank = new Map();
    for (const product of products) {
      const loanType = resolveProductLoanType(product);
      const enriched = { ...product, loan_type: loanType };
      if (!productsByBank.has(product.bank_id)) {
        productsByBank.set(product.bank_id, { all: [], matched: [] });
      }
      const entry = productsByBank.get(product.bank_id);
      entry.all.push(enriched);
      if (!loanTypeFilter || loanType === loanTypeFilter) {
        entry.matched.push(enriched);
      }
    }

    const result = rows.map((bank) => {
      const entry = productsByBank.get(bank.id) || { all: [], matched: [] };
      const bankProducts =
        loanTypeFilter && entry.matched.length > 0 ? entry.matched : entry.all;
      return {
        ...bank,
        bank_products: bankProducts,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

banksRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool();
    const [[row]] = await pool.execute(`SELECT * FROM banks WHERE id = :id LIMIT 1`, { id: req.params.id });
    if (!row) return res.status(404).json({ error: 'Bank not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

banksRouter.post(
  '/',
  authenticate,
  authorize({ resource: 'banks', action: 'manage' }),
  async (req, res, next) => {
    try {
      const input = BankSchema.parse(req.body);
      const pool = getPool();
      const id = newId();
      await pool.execute(
        `INSERT INTO banks (id, name, logo_url, logo_alt, status, display_priority, created_by)
         VALUES (:id, :name, :logo_url, :logo_alt, :status, :display_priority, :created_by)`,
        {
          id,
          name: input.name,
          logo_url: input.logo_url ?? null,
          logo_alt: input.logo_alt ?? null,
          status: input.status ?? 'active',
          display_priority: input.display_priority ?? 0,
          created_by: req.auth.userId,
        },
      );
      const [[row]] = await pool.execute(`SELECT * FROM banks WHERE id = :id`, { id });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

banksRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'banks', action: 'manage' }),
  async (req, res, next) => {
    try {
      const input = BankSchema.partial().parse(req.body);
      const pool = getPool();
      await pool.execute(
        `UPDATE banks
         SET name = COALESCE(:name, name),
             logo_url = COALESCE(:logo_url, logo_url),
             logo_alt = COALESCE(:logo_alt, logo_alt),
             status = COALESCE(:status, status),
             display_priority = COALESCE(:display_priority, display_priority)
         WHERE id = :id`,
        { ...input, id: req.params.id },
      );
      const [[row]] = await pool.execute(`SELECT * FROM banks WHERE id = :id`, { id: req.params.id });
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

banksRouter.delete(
  '/:id',
  authenticate,
  authorize({ resource: 'banks', action: 'manage' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.execute(`DELETE FROM banks WHERE id = :id`, { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

banksRouter.get('/:id/products', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT * FROM bank_products WHERE bank_id = :bankId AND is_active = 1`,
      { bankId: req.params.id },
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

banksRouter.post(
  '/:id/products',
  authenticate,
  authorize({ resource: 'bank_products', action: 'manage' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const id = newId();
      const name = req.body?.name || 'Product';
      await pool.execute(
        `INSERT INTO bank_products (id, bank_id, name, is_active, data)
         VALUES (:id, :bankId, :name, 1, :data)`,
        { id, bankId: req.params.id, name, data: JSON.stringify(req.body || {}) },
      );
      const [[row]] = await pool.execute(`SELECT * FROM bank_products WHERE id = :id`, { id });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

