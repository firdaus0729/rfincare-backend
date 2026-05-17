import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { generateOtp, hashOtp, sendOtpNotification } from '../lib/otp.js';
import { authenticate } from '../middleware/authenticate.js';
import { hasPermission } from '../auth/permissions.js';

export const leadsRouter = Router();

function formatLead(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    loanType: row.loan_type,
    loan_type: row.loan_type,
    source: row.source,
    status: row.status,
    consentAccepted: !!row.consent_accepted,
    consentVerifiedAt: row.consent_verified_at,
    eligibilityScore: row.eligibility_score,
    eligibilityData:
      typeof row.eligibility_data === 'object'
        ? row.eligibility_data
        : row.eligibility_data
          ? JSON.parse(row.eligibility_data)
          : null,
    assignedTo: row.assigned_to,
    applicationId: row.application_id,
    sessionKey: row.session_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CreateLeadSchema = z.object({
  fullName: z.string().min(1).optional(),
  full_name: z.string().min(1).optional(),
  email: z.string().email(),
  phone: z.string().min(10),
  loanType: z.string().optional(),
  loan_type: z.string().optional(),
  source: z.string().optional(),
  consentAccepted: z.boolean().optional(),
  consent_accepted: z.boolean().optional(),
  sessionKey: z.string().optional(),
  session_key: z.string().optional(),
});

leadsRouter.post('/', async (req, res, next) => {
  try {
    const body = CreateLeadSchema.parse(req.body);
    const pool = getPool();
    const id = newId();
    const fullName = body.fullName || body.full_name || '';
    const sessionKey = body.sessionKey || body.session_key || null;

    await pool.execute(
      `INSERT INTO marketing_leads (
         id, full_name, email, phone, loan_type, source, status, consent_accepted, session_key
       ) VALUES (
         :id, :full_name, :email, :phone, :loan_type, :source, 'new', :consent, :session_key
       )`,
      {
        id,
        full_name: fullName,
        email: body.email,
        phone: body.phone,
        loan_type: body.loanType || body.loan_type || null,
        source: body.source || 'eligibility',
        consent: body.consentAccepted || body.consent_accepted ? 1 : 0,
        session_key: sessionKey,
      },
    );

    const [[row]] = await pool.execute(`SELECT * FROM marketing_leads WHERE id = :id`, { id });
    res.status(201).json(formatLead(row));
  } catch (err) {
    next(err);
  }
});

leadsRouter.post('/request-otp', async (req, res, next) => {
  try {
    const { phone, email, leadId } = z
      .object({
        phone: z.string().min(10),
        email: z.string().email().optional(),
        leadId: z.string().optional(),
      })
      .parse(req.body);

    const pool = getPool();
    const otp = generateOtp();
    const id = newId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.execute(
      `INSERT INTO lead_otps (id, lead_id, email, phone, otp_hash, purpose, channel, expires_at)
       VALUES (:id, :lead_id, :email, :phone, :hash, 'lead_verify', 'sms', :exp)`,
      {
        id,
        lead_id: leadId || null,
        email: email || null,
        phone,
        hash: hashOtp(otp),
        exp: expiresAt,
      },
    );

    await sendOtpNotification({ phone, email, otp, channel: 'sms' });
    res.json({ success: true, otpId: id, expiresInSeconds: 600 });
  } catch (err) {
    next(err);
  }
});

leadsRouter.post('/verify-otp', async (req, res, next) => {
  try {
    const { phone, otp, leadId } = z
      .object({
        phone: z.string().min(10),
        otp: z.string().length(6),
        leadId: z.string().optional(),
      })
      .parse(req.body);

    const pool = getPool();
    const [[otpRow]] = await pool.execute(
      `SELECT id, lead_id FROM lead_otps
       WHERE phone = :phone AND otp_hash = :hash AND purpose = 'lead_verify'
         AND verified_at IS NULL AND expires_at > NOW(3)
       ORDER BY created_at DESC LIMIT 1`,
      { phone, hash: hashOtp(otp) },
    );

    if (!otpRow) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    await pool.execute(`UPDATE lead_otps SET verified_at = NOW(3) WHERE id = :id`, { id: otpRow.id });

    const targetLeadId = leadId || otpRow.lead_id;
    if (targetLeadId) {
      await pool.execute(
        `UPDATE marketing_leads SET consent_verified_at = NOW(3), status = 'verified' WHERE id = :id`,
        { id: targetLeadId },
      );
      const [[row]] = await pool.execute(`SELECT * FROM marketing_leads WHERE id = :id`, {
        id: targetLeadId,
      });
      return res.json({ verified: true, lead: formatLead(row) });
    }

    res.json({ verified: true });
  } catch (err) {
    next(err);
  }
});

leadsRouter.patch('/:id', async (req, res, next) => {
  try {
    const pool = getPool();
    const updates = req.body || {};
    const eligibilityData = updates.eligibilityData || updates.eligibility_data;

    await pool.execute(
      `UPDATE marketing_leads SET
         status = COALESCE(:status, status),
         eligibility_score = COALESCE(:score, eligibility_score),
         eligibility_data = COALESCE(:data, eligibility_data),
         application_id = COALESCE(:application_id, application_id)
       WHERE id = :id`,
      {
        id: req.params.id,
        status: updates.status ?? null,
        score: updates.eligibilityScore ?? updates.eligibility_score ?? null,
        data: eligibilityData ? JSON.stringify(eligibilityData) : null,
        application_id: updates.applicationId ?? updates.application_id ?? null,
      },
    );

    const [[row]] = await pool.execute(`SELECT * FROM marketing_leads WHERE id = :id`, {
      id: req.params.id,
    });
    if (!row) return res.status(404).json({ error: 'Lead not found' });
    res.json(formatLead(row));
  } catch (err) {
    next(err);
  }
});

leadsRouter.post('/drafts', async (req, res, next) => {
  try {
    const body = z
      .object({
        sessionKey: z.string().min(8),
        formData: z.record(z.unknown()),
        currentStep: z.number().int().min(0).optional(),
        loanType: z.string().optional(),
        preferredBankId: z.string().optional(),
        loanPriority: z.string().optional(),
        applicationId: z.string().optional(),
      })
      .parse(req.body);

    const pool = getPool();
    const [[existing]] = await pool.execute(
      `SELECT id FROM application_form_drafts WHERE session_key = :sk LIMIT 1`,
      { sk: body.sessionKey },
    );

    if (existing) {
      await pool.execute(
        `UPDATE application_form_drafts SET
           form_data = :data,
           current_step = :step,
           loan_type = COALESCE(:loan_type, loan_type),
           preferred_bank_id = COALESCE(:bank_id, preferred_bank_id),
           loan_priority = COALESCE(:priority, loan_priority),
           application_id = COALESCE(:app_id, application_id)
         WHERE session_key = :sk`,
        {
          sk: body.sessionKey,
          data: JSON.stringify(body.formData),
          step: body.currentStep ?? 0,
          loan_type: body.loanType ?? null,
          bank_id: body.preferredBankId ?? null,
          priority: body.loanPriority ?? null,
          app_id: body.applicationId ?? null,
        },
      );
    } else {
      const id = newId();
      await pool.execute(
        `INSERT INTO application_form_drafts (
           id, session_key, form_data, current_step, loan_type, preferred_bank_id, loan_priority, application_id
         ) VALUES (
           :id, :sk, :data, :step, :loan_type, :bank_id, :priority, :app_id
         )`,
        {
          id,
          sk: body.sessionKey,
          data: JSON.stringify(body.formData),
          step: body.currentStep ?? 0,
          loan_type: body.loanType ?? null,
          bank_id: body.preferredBankId ?? null,
          priority: body.loanPriority ?? null,
          app_id: body.applicationId ?? null,
        },
      );
    }

    res.json({ ok: true, sessionKey: body.sessionKey });
  } catch (err) {
    next(err);
  }
});

leadsRouter.get('/drafts/:sessionKey', async (req, res, next) => {
  try {
    const pool = getPool();
    const [[row]] = await pool.execute(
      `SELECT * FROM application_form_drafts WHERE session_key = :sk LIMIT 1`,
      { sk: req.params.sessionKey },
    );
    if (!row) return res.json(null);

    res.json({
      sessionKey: row.session_key,
      formData: JSON.parse(row.form_data || '{}'),
      currentStep: row.current_step,
      loanType: row.loan_type,
      preferredBankId: row.preferred_bank_id,
      loanPriority: row.loan_priority,
      applicationId: row.application_id,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    next(err);
  }
});

leadsRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const role = req.auth.role;
    if (
      !hasPermission(role, 'read:*')
      && !hasPermission(role, 'manage:*')
      && role !== 'admin'
      && role !== 'super_admin'
      && role !== 'employee'
    ) {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      throw e;
    }

    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT * FROM marketing_leads ORDER BY created_at DESC LIMIT 200`,
    );
    res.json(rows.map(formatLead));
  } catch (err) {
    next(err);
  }
});

leadsRouter.patch('/:id/assign', authenticate, async (req, res, next) => {
  try {
    const role = req.auth.role;
    if (!hasPermission(role, 'manage:*') && role !== 'admin' && role !== 'super_admin') {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      throw e;
    }
    const assigneeId = req.body?.assignedTo || req.body?.assigned_to;
    const pool = getPool();
    await pool.execute(
      `UPDATE marketing_leads SET assigned_to = :assignee, status = 'assigned' WHERE id = :id`,
      { id: req.params.id, assignee: assigneeId },
    );
    const [[row]] = await pool.execute(`SELECT * FROM marketing_leads WHERE id = :id`, {
      id: req.params.id,
    });
    res.json(formatLead(row));
  } catch (err) {
    next(err);
  }
});
