import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { hasPermission } from '../auth/permissions.js';

export const loanApplicationsRouter = Router();

const STAFF_ROLES = new Set(['admin', 'super_admin', 'employee']);

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function canReadAllApplications(role) {
  return hasPermission(role, 'read:all_loan_applications') || hasPermission(role, 'read:*');
}

function formatApplication(row) {
  const data = parseJson(row.data);
  return {
    id: row.id,
    application_number: row.application_number,
    customer_id: row.customer_id,
    agent_id: row.agent_id,
    assigned_employee_id: row.assigned_employee_id,
    selected_bank_id: row.selected_bank_id,
    status: row.status,
    status_notes: row.status_notes,
    review_notes: row.review_notes,
    eligibility_status: row.eligibility_status,
    rejection_reason: row.rejection_reason,
    submitted_at: row.submitted_at,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    loan_type: data.loan_type || data.loanType || null,
    loan_amount: data.loan_amount ?? data.loanAmount ?? null,
    admin_priority: data.admin_priority || data.adminPriority || 'medium',
    customer: row.customer_id
      ? {
          id: row.customer_id,
          full_name: row.customer_full_name,
          email: row.customer_email,
        }
      : null,
    bank: row.selected_bank_id
      ? {
          id: row.selected_bank_id,
          name: row.bank_name,
          logo_url: row.bank_logo_url,
        }
      : null,
    data,
  };
}

const LIST_SELECT = `
  SELECT la.*,
         c.full_name AS customer_full_name,
         c.email AS customer_email,
         b.name AS bank_name,
         b.logo_url AS bank_logo_url
  FROM loan_applications la
  LEFT JOIN user_profiles c ON c.id = la.customer_id
  LEFT JOIN banks b ON b.id = la.selected_bank_id
`;

async function fetchApplicationById(pool, id) {
  const [[row]] = await pool.execute(`${LIST_SELECT} WHERE la.id = :id LIMIT 1`, { id });
  return row;
}

function buildListQuery(role, userId, filters) {
  const conditions = [];
  const params = {};

  if (!canReadAllApplications(role)) {
    if (role === 'customer') {
      conditions.push('la.customer_id = :userId');
      params.userId = userId;
    } else if (role === 'agent') {
      conditions.push('la.agent_id = :userId');
      params.userId = userId;
    } else if (role === 'employee') {
      conditions.push('la.assigned_employee_id = :userId');
      params.userId = userId;
    } else {
      conditions.push('1 = 0');
    }
  }

  if (filters.status && filters.status !== 'all') {
    conditions.push('la.status = :status');
    params.status = filters.status;
  }

  if (filters.search) {
    conditions.push(
      '(c.full_name LIKE :search OR c.email LIKE :search OR la.application_number LIKE :search)',
    );
    params.search = `%${filters.search}%`;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

loanApplicationsRouter.get(
  '/me',
  authenticate,
  async (req, res, next) => {
    try {
      const pool = getPool();
      const { where, params } = buildListQuery(req.auth.role, req.auth.userId, {});
      const [rows] = await pool.execute(
        `${LIST_SELECT} ${where} ORDER BY la.created_at DESC`,
        params,
      );
      res.json(rows.map(formatApplication));
    } catch (err) {
      next(err);
    }
  },
);

loanApplicationsRouter.get(
  '/',
  authenticate,
  async (req, res, next) => {
    try {
      if (!canReadAllApplications(req.auth.role)) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      const pool = getPool();
      const filters = {
        status: req.query.status,
        search: req.query.search,
      };
      const { where, params } = buildListQuery(req.auth.role, req.auth.userId, filters);
      const [rows] = await pool.execute(
        `${LIST_SELECT} ${where} ORDER BY la.created_at DESC`,
        params,
      );

      let apps = rows.map(formatApplication);

      if (req.query.loanType && req.query.loanType !== 'all') {
        const lt = String(req.query.loanType).toLowerCase();
        apps = apps.filter((a) => String(a.loan_type || '').toLowerCase().includes(lt.replace('_loan', '')));
      }

      if (req.query.priority && req.query.priority !== 'all') {
        apps = apps.filter((a) => a.admin_priority === req.query.priority);
      }

      res.json(apps);
    } catch (err) {
      next(err);
    }
  },
);

loanApplicationsRouter.get(
  '/:id',
  authenticate,
  async (req, res, next) => {
    try {
      const pool = getPool();
      const row = await fetchApplicationById(pool, req.params.id);
      if (!row) {
        const e = new Error('Application not found');
        e.status = 404;
        throw e;
      }

      const app = formatApplication(row);
      const isOwner = app.customer_id === req.auth.userId;
      const isAgent = app.agent_id === req.auth.userId;
      const isAssignee = app.assigned_employee_id === req.auth.userId;

      if (
        !canReadAllApplications(req.auth.role)
        && !isOwner
        && !isAgent
        && !isAssignee
      ) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      res.json(app);
    } catch (err) {
      next(err);
    }
  },
);

loanApplicationsRouter.get(
  '/:id/timeline',
  authenticate,
  async (req, res, next) => {
    try {
      const pool = getPool();
      const row = await fetchApplicationById(pool, req.params.id);
      if (!row) {
        const e = new Error('Application not found');
        e.status = 404;
        throw e;
      }

      const [events] = await pool.execute(
        `SELECT id, status, message, created_at
         FROM application_timeline
         WHERE application_id = :id
         ORDER BY created_at ASC`,
        { id: req.params.id },
      );

      res.json(events);
    } catch (err) {
      next(err);
    }
  },
);

loanApplicationsRouter.post(
  '/',
  authenticate,
  authorize({ resource: 'loan_application', action: 'create' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const body = req.body || {};
      const id = newId();
      const customerId = body.customer_id || req.auth.userId;
      const payload = {
        ...body,
        customer_id: customerId,
      };

      await pool.execute(
        `INSERT INTO loan_applications (
          id, application_number, customer_id, agent_id, assigned_employee_id,
          selected_bank_id, status, eligibility_status, data
        ) VALUES (
          :id, :application_number, :customer_id, :agent_id, :assigned_employee_id,
          :selected_bank_id, :status, :eligibility_status, :data
        )`,
        {
          id,
          application_number: body.application_number || `RFC${Date.now()}`,
          customer_id: customerId,
          agent_id: body.agent_id || null,
          assigned_employee_id: body.assigned_employee_id || null,
          selected_bank_id: body.selected_bank_id || null,
          status: body.status || 'draft',
          eligibility_status: body.eligibility_status || null,
          data: JSON.stringify(payload),
        },
      );

      const row = await fetchApplicationById(pool, id);
      res.status(201).json(formatApplication(row));
    } catch (err) {
      next(err);
    }
  },
);

const PatchSchema = z.object({
  status: z.string().optional(),
  status_notes: z.string().optional(),
  review_notes: z.string().optional(),
  rejection_reason: z.string().optional(),
  selected_bank_id: z.string().optional(),
  assigned_employee_id: z.string().optional(),
  eligibility_status: z.string().optional(),
}).passthrough();

loanApplicationsRouter.patch(
  '/:id',
  authenticate,
  async (req, res, next) => {
    try {
      const pool = getPool();
      const existing = await fetchApplicationById(pool, req.params.id);
      if (!existing) {
        const e = new Error('Application not found');
        e.status = 404;
        throw e;
      }

      const canUpdateAll =
        STAFF_ROLES.has(req.auth.role) || hasPermission(req.auth.role, 'update:*');
      const isOwner = existing.customer_id === req.auth.userId;

      if (!canUpdateAll && !isOwner) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      const input = PatchSchema.parse(req.body);
      const mergedData = { ...parseJson(existing.data), ...input };
      const {
        status,
        status_notes,
        review_notes,
        rejection_reason,
        selected_bank_id,
        assigned_employee_id,
        eligibility_status,
        ...rest
      } = input;

      await pool.execute(
        `UPDATE loan_applications SET
          status = COALESCE(:status, status),
          status_notes = COALESCE(:status_notes, status_notes),
          review_notes = COALESCE(:review_notes, review_notes),
          rejection_reason = COALESCE(:rejection_reason, rejection_reason),
          selected_bank_id = COALESCE(:selected_bank_id, selected_bank_id),
          assigned_employee_id = COALESCE(:assigned_employee_id, assigned_employee_id),
          eligibility_status = COALESCE(:eligibility_status, eligibility_status),
          reviewed_by = CASE WHEN :status IS NOT NULL AND :status IN ('approved','rejected') THEN :reviewed_by ELSE reviewed_by END,
          reviewed_at = CASE WHEN :status IS NOT NULL AND :status IN ('approved','rejected') THEN NOW(3) ELSE reviewed_at END,
          data = :data
         WHERE id = :id`,
        {
          id: req.params.id,
          status: status || null,
          status_notes: status_notes || null,
          review_notes: review_notes || null,
          rejection_reason: rejection_reason || null,
          selected_bank_id: selected_bank_id || null,
          assigned_employee_id: assigned_employee_id || null,
          eligibility_status: eligibility_status || null,
          reviewed_by: req.auth.userId,
          data: JSON.stringify({ ...mergedData, ...rest }),
        },
      );

      if (status) {
        await pool.execute(
          `INSERT INTO application_timeline (id, application_id, status, message)
           VALUES (:id, :application_id, :status, :message)`,
          {
            id: newId(),
            application_id: req.params.id,
            status,
            message: review_notes || status_notes || `Status updated to ${status}`,
          },
        );
      }

      const row = await fetchApplicationById(pool, req.params.id);
      res.json(formatApplication(row));
    } catch (err) {
      next(err);
    }
  },
);

loanApplicationsRouter.post(
  '/:id/submit',
  authenticate,
  async (req, res, next) => {
    try {
      const pool = getPool();
      const existing = await fetchApplicationById(pool, req.params.id);
      if (!existing) {
        const e = new Error('Application not found');
        e.status = 404;
        throw e;
      }

      if (existing.customer_id !== req.auth.userId && !STAFF_ROLES.has(req.auth.role)) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      const selectedBankId = req.body?.selected_bank_id || req.body?.selectedBankId || null;

      await pool.execute(
        `UPDATE loan_applications
         SET status = 'submitted',
             submitted_at = NOW(3),
             selected_bank_id = COALESCE(:selected_bank_id, selected_bank_id)
         WHERE id = :id`,
        { id: req.params.id, selected_bank_id: selectedBankId },
      );

      await pool.execute(
        `INSERT INTO application_timeline (id, application_id, status, message)
         VALUES (:id, :application_id, 'submitted', 'Application submitted')`,
        { id: newId(), application_id: req.params.id },
      );

      const row = await fetchApplicationById(pool, req.params.id);
      res.json(formatApplication(row));
    } catch (err) {
      next(err);
    }
  },
);

loanApplicationsRouter.post(
  '/:id/consents',
  authenticate,
  async (req, res, next) => {
    try {
      const pool = getPool();
      const existing = await fetchApplicationById(pool, req.params.id);
      if (!existing) {
        const e = new Error('Application not found');
        e.status = 404;
        throw e;
      }

      const consents = req.body?.consents || [];
      for (const consent of consents) {
        await pool.execute(
          `INSERT INTO application_consents (
            id, application_id, customer_id, consent_type, is_granted, granted_at
          ) VALUES (
            :id, :application_id, :customer_id, :consent_type, :is_granted, :granted_at
          )`,
          {
            id: newId(),
            application_id: req.params.id,
            customer_id: existing.customer_id,
            consent_type: consent.type || consent.consentType || 'general',
            is_granted: consent.granted ?? consent.isGranted ? 1 : 0,
            granted_at: consent.granted ?? consent.isGranted ? new Date() : null,
          },
        );
      }

      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);
