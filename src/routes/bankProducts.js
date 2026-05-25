import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { getPool } from '../db/pool.js';
import { cacheDeletePrefix } from '../lib/simpleCache.js';

const BANK_LIST_CACHE_PREFIX = 'banks:list:';

export const bankProductsRouter = Router();

function parseProductJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function extractProductData(body = {}) {
  const src = body.data != null ? parseProductJson(body.data) : body;
  const merged = { ...src };
  const keys = [
    'loan_type',
    'loanType',
    'interest_rate_min',
    'interestRateMin',
    'interest_rate_max',
    'interestRateMax',
    'processing_fee_percentage',
    'processingFeePercentage',
    'processing_fee_fixed',
    'processingFeeFixed',
    'other_charges',
    'otherCharges',
    'max_loan_amount',
    'maxLoanAmount',
    'max_tenure_years',
    'maxTenureYears',
    'features',
    'required_documents',
    'requiredDocuments',
  ];
  for (const key of keys) {
    if (src[key] !== undefined) merged[key] = src[key];
  }
  if (merged.loanType && !merged.loan_type) merged.loan_type = merged.loanType;
  if (merged.interestRateMin != null && merged.interest_rate_min == null) {
    merged.interest_rate_min = merged.interestRateMin;
  }
  if (merged.interestRateMax != null && merged.interest_rate_max == null) {
    merged.interest_rate_max = merged.interestRateMax;
  }
  if (merged.processingFeePercentage != null && merged.processing_fee_percentage == null) {
    merged.processing_fee_percentage = merged.processingFeePercentage;
  }
  if (merged.otherCharges != null && merged.other_charges == null) {
    merged.other_charges = merged.otherCharges;
  }
  if (merged.maxLoanAmount != null && merged.max_loan_amount == null) {
    merged.max_loan_amount = merged.maxLoanAmount;
  }
  if (merged.maxTenureYears != null && merged.max_tenure_years == null) {
    merged.max_tenure_years = merged.maxTenureYears;
  }
  return merged;
}

bankProductsRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'bank_products', action: 'manage' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [[existing]] = await pool.execute(
        `SELECT * FROM bank_products WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      if (!existing) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const current = parseProductJson(existing.data);
      const patch = extractProductData(req.body);
      const merged = { ...current, ...patch };

      const name = req.body?.name ?? existing.name;
      const isActive =
        req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;

      await pool.execute(
        `UPDATE bank_products
         SET is_active = :is_active,
             name = :name,
             data = :data
         WHERE id = :id`,
        {
          id: req.params.id,
          is_active: isActive,
          name,
          data: JSON.stringify(merged),
        },
      );
      const [[row]] = await pool.execute(`SELECT * FROM bank_products WHERE id = :id`, {
        id: req.params.id,
      });
      cacheDeletePrefix(BANK_LIST_CACHE_PREFIX);
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

bankProductsRouter.delete(
  '/:id',
  authenticate,
  authorize({ resource: 'bank_products', action: 'manage' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.execute(`DELETE FROM bank_products WHERE id = :id`, { id: req.params.id });
      cacheDeletePrefix(BANK_LIST_CACHE_PREFIX);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
