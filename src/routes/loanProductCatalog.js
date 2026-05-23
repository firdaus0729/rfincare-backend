import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/requireRoles.js';
import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';

export const loanProductCatalogRouter = Router();

function parseFeatures(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      return value.split('\n').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function formatInterestRange(min, max) {
  if (min == null || max == null) return null;
  return `${Number(min)}% - ${Number(max)}%`;
}

function formatRow(row) {
  const features = parseFeatures(row.features);
  return {
    id: row.id,
    slug: row.slug,
    api_key: row.api_key,
    label: row.label,
    short_label: row.short_label,
    icon: row.icon || 'Wallet',
    description: row.description,
    interest_rate_min: row.interest_rate_min != null ? Number(row.interest_rate_min) : null,
    interest_rate_max: row.interest_rate_max != null ? Number(row.interest_rate_max) : null,
    interest_range: formatInterestRange(row.interest_rate_min, row.interest_rate_max),
    features,
    color: row.color || 'var(--color-primary)',
    sort_order: row.sort_order ?? 0,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function toApiKey(slug) {
  const s = slugify(slug);
  if (!s) return null;
  return s.endsWith('_loan') ? s : `${s}_loan`;
}

const ProductSchema = z.object({
  slug: z.string().min(1).max(64).optional(),
  api_key: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(255),
  short_label: z.string().max(64).optional().nullable(),
  icon: z.string().max(64).optional(),
  description: z.string().optional().nullable(),
  interest_rate_min: z.coerce.number().min(0).max(100).optional().nullable(),
  interest_rate_max: z.coerce.number().min(0).max(100).optional().nullable(),
  features: z.union([z.array(z.string()), z.string()]).optional(),
  color: z.string().max(32).optional(),
  sort_order: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
});

/** Public: active catalog products for homepage and forms */
loanProductCatalogRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT * FROM loan_product_catalog
       WHERE is_active = 1
       ORDER BY sort_order ASC, label ASC`,
    );
    res.json(rows.map(formatRow));
  } catch (err) {
    next(err);
  }
});

/** Admin: all catalog products */
loanProductCatalogRouter.get(
  '/all',
  authenticate,
  requireRoles('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT * FROM loan_product_catalog ORDER BY sort_order ASC, label ASC`,
      );
      res.json(rows.map(formatRow));
    } catch (err) {
      next(err);
    }
  },
);

loanProductCatalogRouter.post(
  '/',
  authenticate,
  requireRoles('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const body = ProductSchema.parse(req.body);
      const slug = slugify(body.slug || body.label);
      const apiKey = body.api_key ? slugify(body.api_key) : toApiKey(slug);
      if (!slug || !apiKey) {
        const e = new Error('Invalid slug or API key');
        e.status = 400;
        throw e;
      }

      const pool = getPool();
      const id = newId();
      const features = parseFeatures(body.features);

      await pool.execute(
        `INSERT INTO loan_product_catalog (
          id, slug, api_key, label, short_label, icon, description,
          interest_rate_min, interest_rate_max, features, color, sort_order, is_active
        ) VALUES (
          :id, :slug, :api_key, :label, :short_label, :icon, :description,
          :interest_rate_min, :interest_rate_max, :features, :color, :sort_order, :is_active
        )`,
        {
          id,
          slug,
          api_key: apiKey,
          label: body.label,
          short_label: body.short_label || body.label.split(' ')[0],
          icon: body.icon || 'Wallet',
          description: body.description || null,
          interest_rate_min: body.interest_rate_min ?? null,
          interest_rate_max: body.interest_rate_max ?? null,
          features: JSON.stringify(features),
          color: body.color || 'var(--color-primary)',
          sort_order: body.sort_order ?? 0,
          is_active: body.is_active === false ? 0 : 1,
        },
      );

      const [[row]] = await pool.execute(
        `SELECT * FROM loan_product_catalog WHERE id = :id LIMIT 1`,
        { id },
      );
      res.status(201).json(formatRow(row));
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') {
        err.status = 409;
        err.message = 'A product with this slug or API key already exists';
      }
      next(err);
    }
  },
);

loanProductCatalogRouter.patch(
  '/:id',
  authenticate,
  requireRoles('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [[existing]] = await pool.execute(
        `SELECT * FROM loan_product_catalog WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      if (!existing) {
        const e = new Error('Product not found');
        e.status = 404;
        throw e;
      }

      const body = ProductSchema.partial().parse(req.body);
      const slug = body.slug != null ? slugify(body.slug) : existing.slug;
      const apiKey = body.api_key != null ? slugify(body.api_key) : existing.api_key;
      const features =
        body.features !== undefined
          ? parseFeatures(body.features)
          : parseFeatures(existing.features);

      await pool.execute(
        `UPDATE loan_product_catalog SET
          slug = :slug,
          api_key = :api_key,
          label = COALESCE(:label, label),
          short_label = COALESCE(:short_label, short_label),
          icon = COALESCE(:icon, icon),
          description = COALESCE(:description, description),
          interest_rate_min = COALESCE(:interest_rate_min, interest_rate_min),
          interest_rate_max = COALESCE(:interest_rate_max, interest_rate_max),
          features = :features,
          color = COALESCE(:color, color),
          sort_order = COALESCE(:sort_order, sort_order),
          is_active = COALESCE(:is_active, is_active)
         WHERE id = :id`,
        {
          id: req.params.id,
          slug,
          api_key: apiKey,
          label: body.label ?? null,
          short_label: body.short_label ?? null,
          icon: body.icon ?? null,
          description: body.description ?? null,
          interest_rate_min: body.interest_rate_min ?? null,
          interest_rate_max: body.interest_rate_max ?? null,
          features: JSON.stringify(features),
          color: body.color ?? null,
          sort_order: body.sort_order ?? null,
          is_active: body.is_active === undefined ? null : body.is_active ? 1 : 0,
        },
      );

      const [[row]] = await pool.execute(
        `SELECT * FROM loan_product_catalog WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      res.json(formatRow(row));
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') {
        err.status = 409;
        err.message = 'A product with this slug or API key already exists';
      }
      next(err);
    }
  },
);

loanProductCatalogRouter.delete(
  '/:id',
  authenticate,
  requireRoles('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [result] = await pool.execute(
        `DELETE FROM loan_product_catalog WHERE id = :id`,
        { id: req.params.id },
      );
      if (result.affectedRows === 0) {
        const e = new Error('Product not found');
        e.status = 404;
        throw e;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
