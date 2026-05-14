import { Router } from 'express';

import { getPool } from '../db/pool.js';

export const statesRouter = Router();

statesRouter.get('/', async (_req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT id, state_name, is_active
       FROM indian_states
       WHERE is_active = 1
       ORDER BY state_name ASC`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
