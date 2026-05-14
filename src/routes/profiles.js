import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { getPool } from '../db/pool.js';

export const profilesRouter = Router();

const UpdateMeSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().min(6).optional(),
  avatar_url: z.string().url().optional(),
}).passthrough();

profilesRouter.patch(
  '/me',
  authenticate,
  authorize({ resource: 'profile', action: 'update', getOwnerId: (req) => req.auth.userId }),
  async (req, res, next) => {
    try {
      const input = UpdateMeSchema.parse(req.body);
      const pool = getPool();

      await pool.execute(
        `UPDATE user_profiles
         SET full_name = COALESCE(:full_name, full_name),
             phone = COALESCE(:phone, phone)
         WHERE id = :id`,
        { ...input, id: req.auth.userId },
      );

      const [[profile]] = await pool.execute(`SELECT * FROM user_profiles WHERE id = :id LIMIT 1`, {
        id: req.auth.userId,
      });

      res.json({ profile });
    } catch (err) {
      next(err);
    }
  },
);

