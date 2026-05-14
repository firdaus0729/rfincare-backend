import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { getPool } from '../db/pool.js';

export const bankProductsRouter = Router();

bankProductsRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'bank_products', action: 'manage' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.execute(
        `UPDATE bank_products
         SET is_active = COALESCE(:is_active, is_active),
             name = COALESCE(:name, name),
             data = COALESCE(:data, data)
         WHERE id = :id`,
        {
          id: req.params.id,
          is_active: req.body?.is_active,
          name: req.body?.name,
          data: req.body ? JSON.stringify(req.body) : undefined,
        },
      );
      const [[row]] = await pool.execute(`SELECT * FROM bank_products WHERE id = :id`, { id: req.params.id });
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
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

