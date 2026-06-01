import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { authenticate } from '../middleware/authenticate.js';
import { getPool } from '../db/pool.js';
import { ensureMilestone4Schema } from '../db/ensureMilestone4Schema.js';
import { dispatchFileUpdateNotification } from '../lib/fileNotificationService.js';
import { ensureAgentCodeForUser } from '../lib/agentCode.js';

export const portalEmployeeMilestone4Router = Router();

function requireEmployee(req) {
  if (!['employee', 'admin', 'super_admin'].includes(req.auth.role)) {
    const e = new Error('Employee access only');
    e.status = 403;
    throw e;
  }
}

portalEmployeeMilestone4Router.use(authenticate);

portalEmployeeMilestone4Router.get('/customers/:customerId', async (req, res, next) => {
  try {
    requireEmployee(req);
    const pool = getPool();
    const [[customer]] = await pool.execute(
      `SELECT id, full_name, email, phone, avatar_url, customer_code, created_at
       FROM user_profiles WHERE id = :id AND role = 'customer' LIMIT 1`,
      { id: req.params.customerId },
    );
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const [applications] = await pool.execute(
      `SELECT id, application_number, status, journey_mode, submitted_at, created_at
       FROM loan_applications WHERE customer_id = :id ORDER BY created_at DESC`,
      { id: req.params.customerId },
    );

    res.json({
      customer: {
        id: customer.id,
        fullName: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        customerCode: customer.customer_code,
        createdAt: customer.created_at,
      },
      applications,
    });
  } catch (err) {
    next(err);
  }
});

portalEmployeeMilestone4Router.get('/agent-onboarding/pending', async (req, res, next) => {
  try {
    requireEmployee(req);
    await ensureMilestone4Schema();
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT ao.*, up.full_name, up.email, up.phone
       FROM agent_onboarding ao
       JOIN user_profiles up ON up.id = ao.user_id
       WHERE ao.qc_status IN ('pending_qc', 'qc_review')
       ORDER BY ao.created_at ASC`,
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        agentName: r.agent_name,
        agentCode: r.agent_code,
        email: r.email,
        mobileNumber: r.mobile_number,
        qcStatus: r.qc_status,
        onboardingStatus: r.onboarding_status,
        createdAt: r.created_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});

const QcDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().optional(),
});

portalEmployeeMilestone4Router.post('/agent-onboarding/:userId/qc', async (req, res, next) => {
  try {
    requireEmployee(req);
    await ensureMilestone4Schema();
    const input = QcDecisionSchema.parse(req.body);
    const pool = getPool();

    const [[agent]] = await pool.execute(
      `SELECT * FROM agent_onboarding WHERE user_id = :id LIMIT 1`,
      { id: req.params.userId },
    );
    if (!agent) return res.status(404).json({ error: 'Agent onboarding not found' });

    if (input.decision === 'approved') {
      await ensureAgentCodeForUser(pool, req.params.userId);
      await pool.execute(
        `UPDATE agent_onboarding
         SET qc_status = 'qc_approved', qc_employee_id = :emp, qc_notes = :notes, qc_at = NOW(3),
             qc_approved_by = :emp, onboarding_status = 'active'
         WHERE user_id = :id`,
        { id: req.params.userId, emp: req.auth.userId, notes: input.notes || null },
      );
      await pool.execute(
        `UPDATE user_profiles SET is_active = 1, account_status = 'active' WHERE id = :id`,
        { id: req.params.userId },
      );
    } else {
      await pool.execute(
        `UPDATE agent_onboarding
         SET qc_status = 'qc_rejected', qc_employee_id = :emp, qc_notes = :notes, qc_at = NOW(3),
             onboarding_status = 'rejected'
         WHERE user_id = :id`,
        { id: req.params.userId, emp: req.auth.userId, notes: input.notes || 'QC rejected' },
      );
      await pool.execute(
        `UPDATE user_profiles SET is_active = 0, account_status = 'suspended' WHERE id = :id`,
        { id: req.params.userId },
      );
    }

    res.json({ success: true, decision: input.decision });
  } catch (err) {
    next(err);
  }
});

portalEmployeeMilestone4Router.get('/notifications', async (req, res, next) => {
  try {
    requireEmployee(req);
    await ensureMilestone4Schema();
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT id, application_id, event_type, title, message, is_read, created_at
       FROM staff_notifications WHERE user_id = :uid ORDER BY created_at DESC LIMIT 50`,
      { uid: req.auth.userId },
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
