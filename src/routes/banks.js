import { Router } from 'express';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import multer from 'multer';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { getUploadDir } from '../lib/uploadPaths.js';
import { ensureBankSchema } from '../db/ensureBankSchema.js';
import { cacheDeletePrefix, cacheGet, cacheSet } from '../lib/simpleCache.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { newId } from '../lib/ids.js';
import { listRulesForBank } from './approvalMatrixRules.js';

const BANK_LIST_CACHE_PREFIX = 'banks:list:';
const BANK_LIST_CACHE_TTL_MS = 120_000;

function invalidateBankListCache() {
  cacheDeletePrefix(BANK_LIST_CACHE_PREFIX);
}

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

const emptyToNull = (value) =>
  value === '' || value === undefined ? null : value;

const logoUrlSchema = z.preprocess(
  emptyToNull,
  z
    .union([
      z.string().url(),
      z.string().regex(/^\/uploads\/[\w./-]+$/i),
      z.null(),
    ])
    .optional(),
);

const BANK_LOGO_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const bankLogoDir = join(getUploadDir(), 'bank-logos');
mkdirSync(bankLogoDir, { recursive: true });

const bankLogoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(bankLogoDir, { recursive: true });
      cb(null, bankLogoDir);
    },
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname || '') || '.png';
      const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 8) || '.png';
      cb(null, `bank-logo-${Date.now()}-${newId().slice(0, 8)}${safeExt}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (BANK_LOGO_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, WebP, or SVG images are allowed'));
  },
});

const BankSchema = z.object({
  name: z.string().min(1),
  logo_url: logoUrlSchema,
  logo_alt: z.preprocess(emptyToNull, z.string().nullable().optional()),
  status: z.string().optional(),
  display_priority: z.coerce.number().optional(),
  bank_type: z.preprocess(emptyToNull, z.string().nullable().optional()),
  rating: z.coerce.number().optional().nullable(),
  reviews_count: z.coerce.number().optional().nullable(),
  customers_served: z.preprocess(emptyToNull, z.string().nullable().optional()),
  partnership_duration: z.preprocess(emptyToNull, z.string().nullable().optional()),
  certifications: z.array(z.string()).optional().nullable(),
});

function normalizeBankBody(body = {}, { partial = false } = {}) {
  const raw = { ...body };
  if (raw.logoUrl !== undefined && raw.logo_url === undefined) raw.logo_url = raw.logoUrl;
  if (raw.logoAlt !== undefined && raw.logo_alt === undefined) raw.logo_alt = raw.logoAlt;
  if (raw.bankType !== undefined && raw.bank_type === undefined) raw.bank_type = raw.bankType;
  if (raw.displayPriority !== undefined && raw.display_priority === undefined) {
    raw.display_priority = raw.displayPriority;
  }
  if (raw.reviewsCount !== undefined && raw.reviews_count === undefined) {
    raw.reviews_count = raw.reviewsCount;
  }
  if (raw.customersServed !== undefined && raw.customers_served === undefined) {
    raw.customers_served = raw.customersServed;
  }
  if (raw.partnershipDuration !== undefined && raw.partnership_duration === undefined) {
    raw.partnership_duration = raw.partnershipDuration;
  }
  return partial ? BankSchema.partial().parse(raw) : BankSchema.parse(raw);
}

const BANK_COLUMNS = `
  id, name, logo_url, logo_alt, bank_type, status, rating, reviews_count,
  customers_served, partnership_duration, certifications, display_priority, created_by,
  created_at, updated_at
`;

function serializeCertifications(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function parseCertifications(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function formatBankRow(row) {
  if (!row) return row;
  return {
    ...row,
    certifications: parseCertifications(row.certifications),
  };
}

const BANK_LIST_COLUMNS = `
  id, name, logo_url, logo_alt, bank_type, status, rating, reviews_count,
  customers_served, partnership_duration, certifications, display_priority
`;

function slimProductData(rawData) {
  const d = parseProductData(rawData);
  return {
    loan_type: d.loan_type || d.loanType || d.type || d.productType || null,
    interest_rate_min: d.interest_rate_min ?? d.interestRateMin ?? null,
    interest_rate_max: d.interest_rate_max ?? d.interestRateMax ?? null,
    processing_fee_percentage: d.processing_fee_percentage ?? d.processingFeePercentage ?? null,
    processing_fee_fixed: d.processing_fee_fixed ?? d.processingFeeFixed ?? null,
    other_charges: d.other_charges ?? d.otherCharges ?? d.other_fees ?? d.otherFees ?? null,
    max_loan_amount: d.max_loan_amount ?? d.maxLoanAmount ?? null,
    max_tenure_years: d.max_tenure_years ?? d.maxTenureYears ?? null,
    features: d.features ?? null,
  };
}

function slimProductForList(product) {
  const loanType = resolveProductLoanType(product);
  return {
    id: product.id,
    bank_id: product.bank_id,
    name: product.name,
    is_active: product.is_active,
    loan_type: loanType,
    data: slimProductData(product.data),
  };
}

async function fetchBankList({ includeInactive, includeProducts, loanTypeFilter }) {
  const cacheKey = `${BANK_LIST_CACHE_PREFIX}${includeInactive}:${includeProducts}:${loanTypeFilter || 'all'}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT ${BANK_LIST_COLUMNS}
     FROM banks
     ${includeInactive ? '' : "WHERE status = 'active'"}
     ORDER BY display_priority DESC, name ASC`,
  );

  if (!includeProducts) {
    const result = rows.map(formatBankRow);
    cacheSet(cacheKey, result, BANK_LIST_CACHE_TTL_MS);
    return result;
  }

  const [products] = await pool.execute(
    `SELECT id, bank_id, name, is_active, data
     FROM bank_products
     WHERE is_active = 1`,
  );

  const productsByBank = new Map();
  for (const product of products) {
    const slim = slimProductForList(product);
    if (!productsByBank.has(product.bank_id)) {
      productsByBank.set(product.bank_id, { all: [], matched: [] });
    }
    const entry = productsByBank.get(product.bank_id);
    entry.all.push(slim);
    if (!loanTypeFilter || slim.loan_type === loanTypeFilter) {
      entry.matched.push(slim);
    }
  }

  const result = rows.map((bank) => {
    const entry = productsByBank.get(bank.id) || { all: [], matched: [] };
    const bankProducts =
      loanTypeFilter && entry.matched.length > 0 ? entry.matched : entry.all;
    return {
      ...formatBankRow(bank),
      bank_products: bankProducts,
    };
  });

  cacheSet(cacheKey, result, BANK_LIST_CACHE_TTL_MS);
  return result;
}

banksRouter.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const includeProducts = req.query.includeProducts !== 'false';
    const loanTypeFilter = normalizeLoanTypeQuery(req.query.loanType);

    const result = await fetchBankList({ includeInactive, includeProducts, loanTypeFilter });

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

banksRouter.get('/:bankId/approval-matrix-rules', authenticate, async (req, res, next) => {
  try {
    const pool = getPool();
    res.json(await listRulesForBank(pool, req.params.bankId));
  } catch (err) {
    next(err);
  }
});

banksRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool();
    const [[row]] = await pool.execute(`SELECT * FROM banks WHERE id = :id LIMIT 1`, { id: req.params.id });
    if (!row) return res.status(404).json({ error: 'Bank not found' });
    res.json(formatBankRow(row));
  } catch (err) {
    next(err);
  }
});

banksRouter.post(
  '/',
  authenticate,
  authorize({ resource: 'banks', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureBankSchema();
      const input = normalizeBankBody(req.body);
      const pool = getPool();
      const id = newId();
      await pool.execute(
        `INSERT INTO banks (
          id, name, logo_url, logo_alt, bank_type, status, rating, reviews_count,
          customers_served, partnership_duration, certifications, display_priority, created_by
        ) VALUES (
          :id, :name, :logo_url, :logo_alt, :bank_type, :status, :rating, :reviews_count,
          :customers_served, :partnership_duration, :certifications, :display_priority, :created_by
        )`,
        {
          id,
          name: input.name,
          logo_url: input.logo_url ?? null,
          logo_alt: input.logo_alt ?? null,
          bank_type: input.bank_type ?? 'private',
          status: input.status ?? 'active',
          rating: input.rating ?? null,
          reviews_count: input.reviews_count ?? 0,
          customers_served: input.customers_served ?? null,
          partnership_duration: input.partnership_duration ?? null,
          certifications: serializeCertifications(input.certifications ?? []),
          display_priority: input.display_priority ?? 0,
          created_by: req.auth.userId,
        },
      );
      const [[row]] = await pool.execute(
        `SELECT ${BANK_COLUMNS} FROM banks WHERE id = :id`,
        { id },
      );
      invalidateBankListCache();
      res.status(201).json(formatBankRow(row));
    } catch (err) {
      next(err);
    }
  },
);

banksRouter.post(
  '/:id/logo',
  authenticate,
  authorize({ resource: 'banks', action: 'update' }),
  bankLogoUpload.single('logo'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Logo image file is required (field name: logo)' });
      }
      const pool = getPool();
      const [[existing]] = await pool.execute(
        `SELECT id FROM banks WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      if (!existing) return res.status(404).json({ error: 'Bank not found' });

      const logoUrl = `/uploads/bank-logos/${req.file.filename}`;
      await pool.execute(
        `UPDATE banks SET logo_url = :logo_url, updated_at = :updated_at WHERE id = :id`,
        { id: req.params.id, logo_url: logoUrl, updated_at: new Date() },
      );
      const [[row]] = await pool.execute(
        `SELECT ${BANK_COLUMNS} FROM banks WHERE id = :id`,
        { id: req.params.id },
      );
      invalidateBankListCache();
      res.json(formatBankRow(row));
    } catch (err) {
      next(err);
    }
  },
);

banksRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'banks', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureBankSchema();
      const input = normalizeBankBody(req.body, { partial: true });
      const pool = getPool();
      await pool.execute(
        `UPDATE banks
         SET name = COALESCE(:name, name),
             logo_url = COALESCE(:logo_url, logo_url),
             logo_alt = COALESCE(:logo_alt, logo_alt),
             bank_type = COALESCE(:bank_type, bank_type),
             status = COALESCE(:status, status),
             rating = COALESCE(:rating, rating),
             reviews_count = COALESCE(:reviews_count, reviews_count),
             customers_served = COALESCE(:customers_served, customers_served),
             partnership_duration = COALESCE(:partnership_duration, partnership_duration),
             certifications = COALESCE(:certifications, certifications),
             display_priority = COALESCE(:display_priority, display_priority)
         WHERE id = :id`,
        {
          id: req.params.id,
          name: input.name ?? null,
          logo_url: input.logo_url ?? null,
          logo_alt: input.logo_alt ?? null,
          bank_type: input.bank_type ?? null,
          status: input.status ?? null,
          rating: input.rating ?? null,
          reviews_count: input.reviews_count ?? null,
          customers_served: input.customers_served ?? null,
          partnership_duration: input.partnership_duration ?? null,
          certifications: input.certifications != null
            ? serializeCertifications(input.certifications)
            : null,
          display_priority: input.display_priority ?? null,
        },
      );
      const [[row]] = await pool.execute(
        `SELECT ${BANK_COLUMNS} FROM banks WHERE id = :id`,
        { id: req.params.id },
      );
      invalidateBankListCache();
      res.json(formatBankRow(row));
    } catch (err) {
      next(err);
    }
  },
);

banksRouter.delete(
  '/:id',
  authenticate,
  authorize({ resource: 'banks', action: 'update' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.execute(`DELETE FROM banks WHERE id = :id`, { id: req.params.id });
      invalidateBankListCache();
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
  authorize({ resource: 'bank_products', action: 'update' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const id = newId();
      const name = req.body?.name || 'Product';
      const { name: _n, bank_id: _b, bankId: _bid, is_active: _a, ...rest } = req.body || {};
      let productData = rest;
      if (rest.data != null) {
        productData =
          typeof rest.data === 'string'
            ? (() => {
                try {
                  return JSON.parse(rest.data);
                } catch {
                  return rest;
                }
              })()
            : rest.data;
      }
      await pool.execute(
        `INSERT INTO bank_products (id, bank_id, name, is_active, data)
         VALUES (:id, :bankId, :name, 1, :data)`,
        { id, bankId: req.params.id, name, data: JSON.stringify(productData) },
      );
      const [[row]] = await pool.execute(`SELECT * FROM bank_products WHERE id = :id`, { id });
      invalidateBankListCache();
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

