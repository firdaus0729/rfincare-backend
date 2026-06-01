import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { ensureOnboardingSchema } from '../db/ensureOnboardingSchema.js';
import { newId } from '../lib/ids.js';
import { hashOtp, sendDualChannelOtp, sendOtpNotification } from '../lib/otp.js';
import { getOtpProviderSettings } from '../lib/otpProviderSettings.js';
import {
  createResumeToken,
  ensureLeadDraftSession,
  upsertLeadFromDraft,
} from '../lib/resumeTokens.js';
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
    assignedToName: row.assignee_name || null,
    assignedToCode: row.assignee_code || null,
    assignedToRole: row.assignee_role || null,
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

leadsRouter.get('/otp-settings', async (_req, res, next) => {
  try {
    const settings = await getOtpProviderSettings();
    res.json({
      requireMobileOtp: settings.requireMobileOtp,
      requireEmailOtp: settings.requireEmailOtp,
      smsProvider: settings.smsProvider,
      emailProvider: settings.emailProvider,
    });
  } catch (err) {
    next(err);
  }
});

leadsRouter.post('/request-otp', async (req, res, next) => {
  try {
    const { phone, email, leadId } = z
      .object({
        phone: z.string().min(10),
        email: z.string().email(),
        leadId: z.string().optional(),
      })
      .parse(req.body);

    const pool = getPool();
    const settings = await getOtpProviderSettings();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const { mobileOtp, emailOtp } = await sendDualChannelOtp({
      phone,
      email,
      settings,
    });

    const otpIds = {};

    if (settings.requireMobileOtp !== false && mobileOtp) {
      const smsId = newId();
      await pool.execute(
        `INSERT INTO lead_otps (id, lead_id, email, phone, otp_hash, purpose, channel, expires_at)
         VALUES (:id, :lead_id, :email, :phone, :hash, 'lead_verify', 'sms', :exp)`,
        {
          id: smsId,
          lead_id: leadId || null,
          email,
          phone,
          hash: hashOtp(mobileOtp),
          exp: expiresAt,
        },
      );
      otpIds.sms = smsId;
    }

    if (settings.requireEmailOtp !== false && emailOtp) {
      const emailId = newId();
      await pool.execute(
        `INSERT INTO lead_otps (id, lead_id, email, phone, otp_hash, purpose, channel, expires_at)
         VALUES (:id, :lead_id, :email, :phone, :hash, 'lead_verify', 'email', :exp)`,
        {
          id: emailId,
          lead_id: leadId || null,
          email,
          phone,
          hash: hashOtp(emailOtp),
          exp: expiresAt,
        },
      );
      otpIds.email = emailId;
    }

    res.json({
      success: true,
      otpIds,
      expiresInSeconds: 600,
      requireMobileOtp: settings.requireMobileOtp,
      requireEmailOtp: settings.requireEmailOtp,
      smsProvider: settings.smsProvider,
      emailProvider: settings.emailProvider,
      ...(process.env.LOG_OTP === 'true'
        ? { devMobileOtp: mobileOtp, devEmailOtp: emailOtp }
        : {}),
    });
  } catch (err) {
    next(err);
  }
});

leadsRouter.post('/verify-otp', async (req, res, next) => {
  try {
    const body = z
      .object({
        phone: z.string().min(10),
        email: z.string().email(),
        mobileOtp: z.string().length(6).optional(),
        emailOtp: z.string().length(6).optional(),
        otp: z.string().length(6).optional(),
        leadId: z.string().optional(),
      })
      .parse(req.body);

    const settings = await getOtpProviderSettings();
    const mobileCode = body.mobileOtp || (settings.requireEmailOtp === false ? body.otp : undefined);
    const emailCode = body.emailOtp || (settings.requireMobileOtp === false ? body.otp : undefined);

    if (settings.requireMobileOtp && !mobileCode) {
      return res.status(400).json({ error: 'Mobile OTP is required.' });
    }
    if (settings.requireEmailOtp && !emailCode) {
      return res.status(400).json({ error: 'Email OTP is required.' });
    }

    const pool = getPool();
    let smsRow = null;
    let emailRow = null;

    const devTestOtp =
      process.env.LOG_OTP === 'true' &&
      (!settings.requireMobileOtp || mobileCode === '123456') &&
      (!settings.requireEmailOtp || emailCode === '123456');

    if (settings.requireMobileOtp && mobileCode) {
      const [[row]] = await pool.execute(
        devTestOtp
          ? `SELECT id, lead_id FROM lead_otps
             WHERE phone = :phone AND purpose = 'lead_verify' AND channel = 'sms'
               AND verified_at IS NULL AND expires_at > NOW(3)
             ORDER BY created_at DESC LIMIT 1`
          : `SELECT id, lead_id FROM lead_otps
             WHERE phone = :phone AND otp_hash = :hash AND purpose = 'lead_verify' AND channel = 'sms'
               AND verified_at IS NULL AND expires_at > NOW(3)
             ORDER BY created_at DESC LIMIT 1`,
        devTestOtp
          ? { phone: body.phone }
          : { phone: body.phone, hash: hashOtp(mobileCode) },
      );
      smsRow = row;
      if (!smsRow) {
        return res.status(401).json({ error: 'Invalid or expired mobile OTP.' });
      }
    }

    if (settings.requireEmailOtp && emailCode) {
      const [[row]] = await pool.execute(
        devTestOtp
          ? `SELECT id, lead_id FROM lead_otps
             WHERE email = :email AND purpose = 'lead_verify' AND channel = 'email'
               AND verified_at IS NULL AND expires_at > NOW(3)
             ORDER BY created_at DESC LIMIT 1`
          : `SELECT id, lead_id FROM lead_otps
             WHERE email = :email AND otp_hash = :hash AND purpose = 'lead_verify' AND channel = 'email'
               AND verified_at IS NULL AND expires_at > NOW(3)
             ORDER BY created_at DESC LIMIT 1`,
        devTestOtp
          ? { email: body.email }
          : { email: body.email, hash: hashOtp(emailCode) },
      );
      emailRow = row;
      if (!emailRow) {
        return res.status(401).json({ error: 'Invalid or expired email OTP.' });
      }
    }

    const idsToMark = [smsRow?.id, emailRow?.id].filter(Boolean);
    for (const id of idsToMark) {
      await pool.execute(`UPDATE lead_otps SET verified_at = NOW(3) WHERE id = :id`, { id });
    }

    const targetLeadId = body.leadId || smsRow?.lead_id || emailRow?.lead_id;
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

    const leadId = await upsertLeadFromDraft({
      sessionKey: body.sessionKey,
      formData: body.formData,
      loanType: body.loanType,
      currentStep: body.currentStep,
      applicationId: body.applicationId,
    });

    res.json({ ok: true, sessionKey: body.sessionKey, leadId });
  } catch (err) {
    next(err);
  }
});

leadsRouter.post('/drafts/resume-link', async (req, res, next) => {
  try {
    const body = z
      .object({
        sessionKey: z.string().min(8),
        leadId: z.string().optional(),
        frontendOrigin: z.string().url().optional(),
        sendNotification: z.boolean().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
      })
      .parse(req.body);

    const pool = getPool();
    const [[draft]] = await pool.execute(
      `SELECT session_key FROM application_form_drafts WHERE session_key = :sk LIMIT 1`,
      { sk: body.sessionKey },
    );
    if (!draft) {
      return res.status(404).json({ error: 'No saved draft for this session' });
    }

    const link = await createResumeToken({
      sessionKey: body.sessionKey,
      leadId: body.leadId,
      frontendOrigin: body.frontendOrigin,
    });

    if (body.sendNotification && (body.email || body.phone)) {
      const message = `Continue your Rfincare application: ${link.url}`;
      await sendOtpNotification({
        email: body.email,
        phone: body.phone,
        otp: message,
        channel: body.channel || 'email',
      });
    }

    res.json({
      url: link.url,
      expiresAt: link.expiresAt,
      ...(process.env.LOG_OTP === 'true' ? { devToken: link.token } : {}),
    });
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      err.status = 503;
      err.message = 'Run migration 008_milestone2_resume_tokens.sql';
    }
    next(err);
  }
});

leadsRouter.post('/:id/resume-link', authenticate, async (req, res, next) => {
  try {
    const role = req.auth.role;
    if (!hasPermission(role, 'manage:*') && role !== 'admin' && role !== 'super_admin' && role !== 'employee') {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      throw e;
    }

    const pool = getPool();
    const [[lead]] = await pool.execute(`SELECT * FROM marketing_leads WHERE id = :id`, {
      id: req.params.id,
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const body = z
      .object({
        frontendOrigin: z.string().max(512).optional(),
        sendNotification: z.boolean().optional(),
        channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
      })
      .parse(req.body || {});

    const sessionKey = await ensureLeadDraftSession(pool, lead);

    const link = await createResumeToken({
      sessionKey,
      leadId: lead.id,
      frontendOrigin: body.frontendOrigin,
    });

    if (body.sendNotification) {
      const message = `Continue your Rfincare application: ${link.url}`;
      await sendOtpNotification({
        email: lead.email,
        phone: lead.phone,
        otp: message,
        channel: body.channel || 'email',
      });
    }

    res.json({ url: link.url, expiresAt: link.expiresAt, lead: formatLead(lead) });
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

    await ensureOnboardingSchema();
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT ml.*,
              up.full_name AS assignee_name,
              up.role AS assignee_role,
              COALESCE(ao.agent_code, eo.employee_code) AS assignee_code
       FROM marketing_leads ml
       LEFT JOIN user_profiles up ON up.id = ml.assigned_to
       LEFT JOIN agent_onboarding ao ON ao.user_id = up.id AND up.role = 'agent'
       LEFT JOIN employee_onboarding eo ON eo.user_id = up.id AND up.role = 'employee'
       ORDER BY ml.created_at DESC
       LIMIT 200`,
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
