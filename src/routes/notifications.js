import { Router } from 'express';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';

export const notificationsRouter = Router();

function formatNotification(row) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    customerId: row.customer_id,
    title: row.title,
    message: row.message,
    is_read: !!row.is_read,
    isRead: !!row.is_read,
    created_at: row.created_at,
    createdAt: row.created_at,
  };
}

notificationsRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT id, customer_id, title, message, is_read, created_at
       FROM customer_notifications
       WHERE customer_id = :customerId
       ORDER BY created_at DESC
       LIMIT 100`,
      { customerId: req.auth.userId },
    );
    res.json(rows.map(formatNotification));
  } catch (err) {
    next(err);
  }
});

notificationsRouter.get('/customers/:customerId', authenticate, async (req, res, next) => {
  try {
    if (
      req.auth.role !== 'admin'
      && req.auth.role !== 'super_admin'
      && req.auth.role !== 'employee'
      && req.params.customerId !== req.auth.userId
    ) {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      throw e;
    }
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT id, customer_id, title, message, is_read, created_at
       FROM customer_notifications
       WHERE customer_id = :customerId
       ORDER BY created_at DESC
       LIMIT 100`,
      { customerId: req.params.customerId },
    );
    res.json(rows.map(formatNotification));
  } catch (err) {
    next(err);
  }
});

notificationsRouter.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.execute(
      `UPDATE customer_notifications
       SET is_read = 1
       WHERE id = :id AND customer_id = :customerId`,
      { id: req.params.id, customerId: req.auth.userId },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.patch('/me/read-all', authenticate, async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.execute(
      `UPDATE customer_notifications SET is_read = 1 WHERE customer_id = :customerId`,
      { customerId: req.auth.userId },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Create notification (internal / timeline hook). */
export async function createCustomerNotification(pool, { customerId, title, message, type = 'general' }) {
  const id = newId();
  await pool.execute(
    `INSERT INTO customer_notifications (id, customer_id, title, message, is_read)
     VALUES (:id, :customer_id, :title, :message, 0)`,
    { id, customer_id: customerId, title, message },
  );
  return id;
}
