import { Router } from 'express';
import { z } from 'zod';
import { unlink } from 'node:fs/promises';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { generateOtp, hashOtp, sendOtpNotification } from '../lib/otp.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { hasPermission } from '../auth/permissions.js';
import { createCustomerNotification } from './notifications.js';
import { writeAuditLog } from '../lib/audit.js';
import { requireSuccessfulCibilForSubmit } from '../lib/cibilService.js';
import { dispatchFileUpdateNotification } from '../lib/fileNotificationService.js';
import { buildSimpleTextPdf } from '../lib/simplePdf.js';

export const loanApplicationsRouter = Router();

const STAFF_ROLES = new Set(['admin', 'super_admin', 'employee']);
const ADMIN_DELETE_ROLES = new Set(['admin', 'super_admin']);
const ADMIN_DELETE_OTP_PURPOSE = 'admin_delete_apps';
const DOCUMENT_STAGE_OPTIONS = new Set([
  'documents_pending',
  'documents_received',
  'submitted_to_bank',
  'under_process',
  'pending_at_qc',
  'at_kyc_stage',
  'at_bgv_stage',
  'at_credit_stage',
  'at_property_valuation_stage',
  'at_property_technical_stage',
  'at_disbursement_stage',
  'documents_verified',
]);
const BANK_APPROVAL_STAGE_OPTIONS = new Set([
  'submitted_to_bank',
  'under_process',
  'pending_at_qc',
  'at_kyc_stage',
  'at_bgv_stage',
  'at_credit_stage',
  'at_property_valuation_stage',
  'at_property_technical_stage',
  'at_disbursement_stage',
  'bank_rejected',
]);

function canDeleteApplications(role) {
  return ADMIN_DELETE_ROLES.has(role) || hasPermission(role, 'delete:loan_applications');
}

async function hardDeleteApplications(pool, applicationIds) {
  if (!applicationIds.length) return { deleted: 0 };

  const params = {};
  const placeholders = applicationIds.map((id, i) => {
    const key = `id${i}`;
    params[key] = id;
    return `:${key}`;
  });
  const inClause = placeholders.join(', ');

  const [docs] = await pool.execute(
    `SELECT id, file_path FROM customer_documents WHERE application_id IN (${inClause})`,
    params,
  );

  for (const doc of docs) {
    if (doc.file_path) {
      try {
        await unlink(doc.file_path);
      } catch {
        /* file may already be gone */
      }
    }
  }

  await pool.execute(`DELETE FROM customer_documents WHERE application_id IN (${inClause})`, params);
  await pool.execute(`DELETE FROM application_consents WHERE application_id IN (${inClause})`, params);
  await pool.execute(`DELETE FROM otp_verifications WHERE application_id IN (${inClause})`, params);
  await pool.execute(
    `UPDATE marketing_leads SET application_id = NULL WHERE application_id IN (${inClause})`,
    params,
  );
  await pool.execute(
    `UPDATE application_form_drafts SET application_id = NULL WHERE application_id IN (${inClause})`,
    params,
  );

  const [result] = await pool.execute(
    `DELETE FROM loan_applications WHERE id IN (${inClause})`,
    params,
  );

  return { deleted: result.affectedRows ?? applicationIds.length };
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function resolveAgentCode(pool, agentId) {
  if (!agentId) return null;
  const [[agent]] = await pool.execute(
    `SELECT agent_code FROM agent_onboarding WHERE user_id = :id LIMIT 1`,
    { id: agentId },
  );
  return agent?.agent_code || null;
}

function canReadAllApplications(role) {
  return hasPermission(role, 'read:all_loan_applications') || hasPermission(role, 'read:*');
}

const LOAN_TYPE_LABELS = {
  personal_loan: 'Personal Loan',
  home_loan: 'Home Loan',
  business_loan: 'Business Loan',
  auto_loan: 'Auto Loan',
  education_loan: 'Education Loan',
};

function humanizeLoanType(value) {
  if (value == null || value === '') return null;
  const key = String(value).toLowerCase().replace(/-/g, '_');
  if (LOAN_TYPE_LABELS[key]) return LOAN_TYPE_LABELS[key];
  if (key.endsWith('_loan') && LOAN_TYPE_LABELS[key]) return LOAN_TYPE_LABELS[key];
  const slug = key.replace(/_loan$/, '');
  if (LOAN_TYPE_LABELS[`${slug}_loan`]) return LOAN_TYPE_LABELS[`${slug}_loan`];
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Read loan fields from assessment payload (supports legacy + current field names). */
function extractLoanFields(data) {
  const d = data && typeof data === 'object' ? data : {};
  const loanAmount =
    d.loan_amount ??
    d.loanAmount ??
    d.requested_loan_amount ??
    d.requestedLoanAmount ??
    null;
  const loanTypeRaw =
    d.loan_type ?? d.loanType ?? d.loan_purpose ?? d.loanPurpose ?? null;
  return {
    loan_amount: loanAmount != null && loanAmount !== '' ? Number(loanAmount) : null,
    loan_type: loanTypeRaw,
    loan_type_label: humanizeLoanType(loanTypeRaw),
    admin_priority: d.admin_priority || d.adminPriority || 'medium',
  };
}

function normalizeApplicationPayload(body) {
  const base = { ...(body || {}) };
  const extracted = extractLoanFields(base);
  return {
    ...base,
    loan_amount: extracted.loan_amount ?? base.loan_amount,
    loan_type: extracted.loan_type ?? base.loan_type,
    requested_loan_amount:
      base.requested_loan_amount ?? base.requestedLoanAmount ?? extracted.loan_amount,
    loan_purpose: base.loan_purpose ?? base.loanPurpose ?? extracted.loan_type,
  };
}

function formatApplication(row) {
  const data = parseJson(row.data);
  const loan = extractLoanFields(data);
  return {
    id: row.id,
    application_number: row.application_number,
    customer_id: row.customer_id,
    agent_id: row.agent_id,
    sourced_agent_code: row.sourced_agent_code || null,
    assigned_employee_id: row.assigned_employee_id,
    qc_employee_id: row.qc_employee_id || null,
    qc_admin_id: row.qc_admin_id || null,
    selected_bank_id: row.selected_bank_id,
    status: row.status,
    document_stage_status: row.document_stage_status || 'documents_pending',
    bank_approval_status: row.bank_approval_status || 'submitted_to_bank',
    status_notes: row.status_notes,
    review_notes: row.review_notes,
    eligibility_status: row.eligibility_status,
    rejection_reason: row.rejection_reason,
    submitted_at: row.submitted_at,
    journey_mode: row.journey_mode || 'assessment',
    cibil_status: row.cibil_status || null,
    cibil_checked_at: row.cibil_checked_at || null,
    disbursed_amount: row.disbursed_amount,
    disbursed_at: row.disbursed_at,
    commission_status: row.commission_status,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    qc_updated_at: row.qc_updated_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    loan_type: loan.loan_type,
    loan_type_label: loan.loan_type_label,
    loan_amount: loan.loan_amount,
    admin_priority: loan.admin_priority,
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

const BulkStatusSchema = z.object({
  applicationIds: z.array(z.string().min(1)).min(1),
  status: z.enum(['approved', 'rejected']),
  review_notes: z.string().optional(),
  rejection_reason: z.string().optional(),
});

loanApplicationsRouter.post(
  '/bulk-status',
  authenticate,
  authorize({ resource: 'loan_applications', action: 'update' }),
  async (req, res, next) => {
    try {
      if (!STAFF_ROLES.has(req.auth.role) && !hasPermission(req.auth.role, 'update:*')) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      const input = BulkStatusSchema.parse(req.body);
      const pool = getPool();
      let updated = 0;

      for (const id of input.applicationIds) {
        const existing = await fetchApplicationById(pool, id);
        if (!existing) continue;

        await pool.execute(
          `UPDATE loan_applications SET
             status = :status,
             review_notes = COALESCE(:review_notes, review_notes),
             rejection_reason = COALESCE(:rejection_reason, rejection_reason),
             reviewed_by = :reviewed_by,
             reviewed_at = NOW(3)
           WHERE id = :id`,
          {
            id,
            status: input.status,
            review_notes: input.review_notes || null,
            rejection_reason: input.rejection_reason || null,
            reviewed_by: req.auth.userId,
          },
        );

        await writeAuditLog({
          userId: req.auth.userId,
          actionType: input.status === 'approved' ? 'APPROVE' : 'REJECT',
          tableName: 'loan_applications',
          recordId: id,
          oldValues: { status: existing.status },
          newValues: { status: input.status },
        });

        updated += 1;
      }

      res.json({ updated, status: input.status });
    } catch (err) {
      next(err);
    }
  },
);

loanApplicationsRouter.post(
  '/bulk-delete/request-otp',
  authenticate,
  authorize({ resource: 'loan_applications', action: 'delete' }),
  async (req, res, next) => {
    try {
      if (!canDeleteApplications(req.auth.role)) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      const pool = getPool();
      const [[profile]] = await pool.execute(
        `SELECT email, full_name FROM user_profiles WHERE id = :id LIMIT 1`,
        { id: req.auth.userId },
      );
      if (!profile?.email) {
        return res.status(400).json({ error: 'Admin email not found on your profile' });
      }

      const otp = generateOtp();
      const otpId = newId();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await pool.execute(
        `INSERT INTO lead_otps (id, lead_id, email, phone, otp_hash, purpose, channel, expires_at)
         VALUES (:id, NULL, :email, NULL, :hash, :purpose, 'email', :exp)`,
        {
          id: otpId,
          email: profile.email,
          hash: hashOtp(otp),
          purpose: ADMIN_DELETE_OTP_PURPOSE,
          exp: expiresAt,
        },
      );

      await sendOtpNotification({
        email: profile.email,
        otp,
        channel: 'email',
      });

      res.json({
        success: true,
        email: profile.email,
        otpId,
        expiresInSeconds: 600,
        message: `OTP sent to ${profile.email}`,
        ...(process.env.LOG_OTP === 'true' ? { devOtp: otp } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

const BulkDeleteConfirmSchema = z.object({
  applicationIds: z.array(z.string().min(1)).min(1).max(100),
  otp: z.string().length(6),
});

loanApplicationsRouter.post(
  '/bulk-delete/confirm',
  authenticate,
  authorize({ resource: 'loan_applications', action: 'delete' }),
  async (req, res, next) => {
    try {
      if (!canDeleteApplications(req.auth.role)) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      const input = BulkDeleteConfirmSchema.parse(req.body);
      const pool = getPool();

      const [[profile]] = await pool.execute(
        `SELECT email FROM user_profiles WHERE id = :id LIMIT 1`,
        { id: req.auth.userId },
      );
      if (!profile?.email) {
        return res.status(400).json({ error: 'Admin email not found' });
      }

      const [[otpRow]] = await pool.execute(
        `SELECT id FROM lead_otps
         WHERE email = :email AND otp_hash = :hash AND purpose = :purpose
           AND verified_at IS NULL AND expires_at > NOW(3)
         ORDER BY created_at DESC LIMIT 1`,
        {
          email: profile.email,
          hash: hashOtp(input.otp),
          purpose: ADMIN_DELETE_OTP_PURPOSE,
        },
      );

      if (!otpRow) {
        return res.status(401).json({ error: 'Invalid or expired OTP' });
      }

      await pool.execute(`UPDATE lead_otps SET verified_at = NOW(3) WHERE id = :id`, {
        id: otpRow.id,
      });

      const uniqueIds = [...new Set(input.applicationIds)];
      const { deleted } = await hardDeleteApplications(pool, uniqueIds);

      res.json({
        success: true,
        deleted,
        message: `${deleted} application(s) permanently deleted`,
      });
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
      const payload = normalizeApplicationPayload({
        ...body,
        customer_id: customerId,
      });

      await pool.execute(
        `INSERT INTO loan_applications (
          id, application_number, customer_id, agent_id, sourced_agent_code, assigned_employee_id,
          qc_employee_id, qc_admin_id, selected_bank_id, status, document_stage_status,
          bank_approval_status, eligibility_status, data
        ) VALUES (
          :id, :application_number, :customer_id, :agent_id, :sourced_agent_code, :assigned_employee_id,
          :qc_employee_id, :qc_admin_id, :selected_bank_id, :status, :document_stage_status,
          :bank_approval_status, :eligibility_status, :data
        )`,
        {
          agent_id: body.agent_id || null,
          sourced_agent_code:
            body.sourced_agent_code
            || body.agent_code
            || (body.agent_id ? await resolveAgentCode(pool, body.agent_id) : null),
          qc_employee_id: body.qc_employee_id || null,
          qc_admin_id: body.qc_admin_id || null,
          document_stage_status: body.document_stage_status || 'documents_pending',
          bank_approval_status: body.bank_approval_status || 'submitted_to_bank',
          id,
          application_number: body.application_number || `RFC${Date.now()}`,
          customer_id: customerId,
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
  sourced_agent_code: z.string().optional(),
  assigned_employee_id: z.string().optional(),
  qc_employee_id: z.string().optional(),
  qc_admin_id: z.string().optional(),
  eligibility_status: z.string().optional(),
  document_stage_status: z.string().optional(),
  bank_approval_status: z.string().optional(),
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
      if (!canUpdateAll) {
        delete input.document_stage_status;
        delete input.bank_approval_status;
        delete input.qc_employee_id;
        delete input.qc_admin_id;
        delete input.sourced_agent_code;
      }
      const mergedData = { ...parseJson(existing.data), ...input };
      const {
        status,
        status_notes,
        review_notes,
        rejection_reason,
        selected_bank_id,
        sourced_agent_code,
        assigned_employee_id,
        qc_employee_id,
        qc_admin_id,
        eligibility_status,
        document_stage_status,
        bank_approval_status,
        ...rest
      } = input;

      if (document_stage_status && !DOCUMENT_STAGE_OPTIONS.has(document_stage_status)) {
        return res.status(400).json({ error: 'Invalid document stage status' });
      }
      if (bank_approval_status && !BANK_APPROVAL_STAGE_OPTIONS.has(bank_approval_status)) {
        return res.status(400).json({ error: 'Invalid bank approval status' });
      }

      const statusValue = status ?? null;
      const markReviewed =
        statusValue === 'approved' || statusValue === 'rejected';

      const employeeQcUpdater =
        req.auth.role === 'employee' && (document_stage_status || bank_approval_status);
      const adminQcUpdater =
        (req.auth.role === 'admin' || req.auth.role === 'super_admin')
        && (document_stage_status || bank_approval_status);
      const canEditQcIdentity = req.auth.role === 'admin' || req.auth.role === 'super_admin';

      await pool.execute(
        `UPDATE loan_applications SET
          status = COALESCE(:status, status),
          status_notes = COALESCE(:status_notes, status_notes),
          review_notes = COALESCE(:review_notes, review_notes),
          rejection_reason = COALESCE(:rejection_reason, rejection_reason),
          selected_bank_id = COALESCE(:selected_bank_id, selected_bank_id),
          sourced_agent_code = COALESCE(:sourced_agent_code, sourced_agent_code),
          assigned_employee_id = COALESCE(:assigned_employee_id, assigned_employee_id),
          qc_employee_id = CASE
            WHEN :set_qc_employee_auto = 1 THEN :reviewed_by
            WHEN :can_edit_qc_identity = 1 THEN COALESCE(:qc_employee_id, qc_employee_id)
            ELSE qc_employee_id
          END,
          qc_admin_id = CASE
            WHEN :set_qc_admin_auto = 1 THEN :reviewed_by
            WHEN :can_edit_qc_identity = 1 THEN COALESCE(:qc_admin_id, qc_admin_id)
            ELSE qc_admin_id
          END,
          qc_updated_at = CASE
            WHEN :set_qc_updated = 1 THEN NOW(3)
            ELSE qc_updated_at
          END,
          document_stage_status = COALESCE(:document_stage_status, document_stage_status),
          bank_approval_status = COALESCE(:bank_approval_status, bank_approval_status),
          eligibility_status = COALESCE(:eligibility_status, eligibility_status),
          reviewed_by = CASE WHEN :mark_reviewed = 1 THEN :reviewed_by ELSE reviewed_by END,
          reviewed_at = CASE WHEN :mark_reviewed = 1 THEN NOW(3) ELSE reviewed_at END,
          data = :data
         WHERE id = :id`,
        {
          id: req.params.id,
          status: statusValue,
          status_notes: status_notes || null,
          review_notes: review_notes || null,
          rejection_reason: rejection_reason || null,
          selected_bank_id: selected_bank_id || null,
          sourced_agent_code: sourced_agent_code || null,
          assigned_employee_id: assigned_employee_id || null,
          qc_employee_id: qc_employee_id || null,
          qc_admin_id: qc_admin_id || null,
          can_edit_qc_identity: canEditQcIdentity ? 1 : 0,
          set_qc_employee_auto: employeeQcUpdater ? 1 : 0,
          set_qc_admin_auto: adminQcUpdater ? 1 : 0,
          set_qc_updated: document_stage_status || bank_approval_status ? 1 : 0,
          document_stage_status: document_stage_status || null,
          bank_approval_status: bank_approval_status || null,
          eligibility_status: eligibility_status || null,
          mark_reviewed: markReviewed ? 1 : 0,
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

      if (document_stage_status || bank_approval_status) {
        await pool.execute(
          `INSERT INTO application_timeline (id, application_id, status, message)
           VALUES (:id, :application_id, :status, :message)`,
          {
            id: newId(),
            application_id: req.params.id,
            status: bank_approval_status || document_stage_status || 'qc_update',
            message:
              `QC stage update: document=${document_stage_status || existing.document_stage_status}, `
              + `bank=${bank_approval_status || existing.bank_approval_status}`,
          },
        );
      }

      const row = await fetchApplicationById(pool, req.params.id);

      if (
        (document_stage_status || bank_approval_status)
        && existing.status === 'submitted'
        && existing.submitted_at
      ) {
        dispatchFileUpdateNotification('application_stage_after_bank', {
          applicationId: req.params.id,
          extra: {
            title: 'Application stage updated',
            message: `Bank processing stage is now ${bank_approval_status || document_stage_status}.`,
          },
        }).catch(() => {});
      }

      res.json(formatApplication(row));
    } catch (err) {
      next(err);
    }
  },
);

loanApplicationsRouter.get('/:id/summary-pdf', authenticate, async (req, res, next) => {
  try {
    const pool = getPool();
    const row = await fetchApplicationById(pool, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const isOwner = row.customer_id === req.auth.userId;
    const isStaff = STAFF_ROLES.has(req.auth.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    const data = parseJson(row.data);
    const lines = [
      'Rfincare — Loan Application Summary (Read-only)',
      `Application: ${row.application_number || row.id}`,
      `Status: ${row.status}`,
      `Submitted: ${row.submitted_at || '—'}`,
      '',
      'NON-EDITABLE FINAL SUBMITTED DETAILS',
      'For changes contact our helpline or write to support@rfincare.com',
      '',
      `Name: ${data.firstName || ''} ${data.lastName || ''}`.trim(),
      `Email: ${data.email || row.customer_email || '—'}`,
      `Phone: ${data.phone || data.mobile || '—'}`,
      `Loan type: ${data.loan_type || data.loan_purpose || '—'}`,
      `Amount: ${data.loan_amount || data.requested_loan_amount || '—'}`,
    ];
    const pdf = buildSimpleTextPdf(lines);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="application-${row.application_number || row.id}.pdf"`,
    );
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

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

      try {
        await requireSuccessfulCibilForSubmit(req.params.id);
      } catch (cibilErr) {
        if (cibilErr.status === 422) {
          return res.status(422).json({
            error: cibilErr.message,
            cibilStatus: cibilErr.cibilStatus || 'failed',
            manualReview: true,
          });
        }
        throw cibilErr;
      }

      await pool.execute(
        `UPDATE loan_applications
         SET status = 'submitted',
             journey_mode = 'document_only',
             document_stage_status = COALESCE(document_stage_status, 'documents_pending'),
             bank_approval_status = 'submitted_to_bank',
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

      try {
        await createCustomerNotification(pool, {
          customerId: existing.customer_id,
          title: 'Application submitted',
          message: 'Your loan application has been submitted successfully. We will notify you of updates.',
        });
      } catch {
        /* notifications table may be missing on older DBs */
      }

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

      const raw = req.body?.consents;
      const consentEntries = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
          ? Object.entries(raw).map(([type, granted]) => ({ type, granted: Boolean(granted) }))
          : [];

      for (const consent of consentEntries) {
        const granted = consent.granted ?? consent.isGranted ?? false;
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
            is_granted: granted ? 1 : 0,
            granted_at: granted ? new Date() : null,
          },
        );
      }

      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);
