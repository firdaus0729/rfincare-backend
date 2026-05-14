import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { newId } from '../lib/ids.js';

export const banksRouter = Router();

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
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT * FROM banks ${includeInactive ? '' : "WHERE status = 'active'"} ORDER BY display_priority DESC`,
    );
    res.json(rows);
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

