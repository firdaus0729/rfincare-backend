import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const auditLogsRouter = Router();

const LogSchema = z.object({
  actionType: z.string().min(1).optional(),
  action_type: z.string().min(1).optional(),
  tableName: z.string().min(1).optional(),
  table_name: z.string().min(1).optional(),
  recordId: z.union([z.string(), z.number()]).nullable().optional(),
  record_id: z.union([z.string(), z.number()]).nullable().optional(),
  oldValues: z.unknown().optional().nullable(),
  old_values: z.unknown().optional().nullable(),
  newValues: z.unknown().optional().nullable(),
  new_values: z.unknown().optional().nullable(),
});

function jsonOrNull(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

auditLogsRouter.post('/', authenticate, async (req, res, next) => {
  try {
    const input = LogSchema.parse(req.body);
    const actionType = input.actionType || input.action_type;
    const tableName = input.tableName || input.table_name;
    const recordId = input.recordId ?? input.record_id ?? null;

    if (!actionType || !tableName) {
      const e = new Error('actionType and tableName are required');
      e.status = 400;
      throw e;
    }

    const pool = getPool();
    const id = newId();

    await pool.execute(
      `INSERT INTO audit_logs (id, user_id, action_type, table_name, record_id, old_values, new_values)
       VALUES (:id, :user_id, :action_type, :table_name, :record_id, :old_values, :new_values)`,
      {
        id,
        user_id: req.auth.userId,
        action_type: actionType,
        table_name: tableName,
        record_id: recordId != null ? String(recordId) : null,
        old_values: jsonOrNull(input.oldValues ?? input.old_values),
        new_values: jsonOrNull(input.newValues ?? input.new_values),
      },
    );

    res.status(201).json({ id, ok: true });
  } catch (err) {
    next(err);
  }
});

auditLogsRouter.get(
  '/',
  authenticate,
  authorize({ resource: 'audit_logs', action: 'read' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const tableName = req.query.tableName || req.query.table_name;

      let sql = `SELECT id, user_id, action_type, table_name, record_id, old_values, new_values, created_at
                 FROM audit_logs`;
      const params = { limit };

      if (tableName) {
        sql += ' WHERE table_name = :table_name';
        params.table_name = tableName;
      }

      sql += ' ORDER BY created_at DESC LIMIT :limit';

      const [rows] = await pool.execute(sql, params);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);
