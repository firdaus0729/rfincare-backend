import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { generateOtp, hashOtp, sendOtpNotification } from '../lib/otp.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const statusCheckAdminRouter = Router();

function formatApplication(row) {
  let data = row.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  return {
    id: row.id,
    applicationNumber: row.application_number,
    status: row.status,
    eligibilityStatus: row.eligibility_status,
    statusNotes: row.status_notes,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    requestedLoanAmount: row.requested_loan_amount,
    loanPurpose: row.loan_purpose,
    data,
  };
}

statusCheckAdminRouter.get(
  '/lookup',
  authenticate,
  authorize({ resource: 'loan_applications', action: 'read' }),
  async (req, res, next) => {
    try {
      const email = req.query.email?.toString().trim();
      const applicationNumber = req.query.applicationNumber?.toString().trim();
      if (!email && !applicationNumber) {
        return res.status(400).json({ error: 'Provide email or applicationNumber' });
      }

      const pool = getPool();
      const conditions = [];
      const params = {};

      if (email) {
        conditions.push('up.email = :email');
        params.email = email;
      }
      if (applicationNumber) {
        conditions.push('la.application_number = :num');
        params.num = applicationNumber;
      }

      const [rows] = await pool.execute(
        `SELECT la.id, la.application_number, la.status, la.eligibility_status,
                la.status_notes, la.updated_at, la.created_at, la.requested_loan_amount,
                la.loan_purpose, la.data,
                up.email AS customer_email, up.full_name AS customer_name, up.phone AS customer_phone
         FROM loan_applications la
         JOIN user_profiles up ON up.id = la.customer_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY la.updated_at DESC
         LIMIT 20`,
        params,
      );

      res.json({ applications: rows.map(formatApplication) });
    } catch (err) {
      next(err);
    }
  },
);

statusCheckAdminRouter.get(
  '/otp-log',
  authenticate,
  authorize({ resource: 'loan_applications', action: 'read' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT id, email, phone, channel, verified_at, expires_at, created_at
         FROM status_check_otps
         ORDER BY created_at DESC
         LIMIT 100`,
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

const SendOtpSchema = z.object({
  email: z.string().email(),
  phone: z.string().optional(),
  channel: z.enum(['email', 'sms', 'whatsapp']).default('email'),
});

statusCheckAdminRouter.post(
  '/send-otp',
  authenticate,
  authorize({ resource: 'loan_applications', action: 'update' }),
  async (req, res, next) => {
    try {
      const input = SendOtpSchema.parse(req.body);
      const pool = getPool();

      const [[app]] = await pool.execute(
        `SELECT la.id FROM loan_applications la
         JOIN user_profiles up ON up.id = la.customer_id
         WHERE up.email = :email LIMIT 1`,
        { email: input.email },
      );
      if (!app) {
        return res.status(404).json({ error: 'No application found for this email' });
      }

      const otp = generateOtp();
      const id = newId();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await pool.execute(
        `INSERT INTO status_check_otps (id, email, phone, otp_hash, channel, expires_at)
         VALUES (:id, :email, :phone, :hash, :channel, :exp)`,
        {
          id,
          email: input.email,
          phone: input.phone ?? null,
          hash: hashOtp(otp),
          channel: input.channel,
          exp: expiresAt,
        },
      );

      await sendOtpNotification({ ...input, otp });

      res.json({
        success: true,
        message: 'OTP sent',
        expiresInSeconds: 600,
        otpId: id,
        ...(process.env.LOG_OTP === 'true' ? { devOtp: otp } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

const VerifySchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  applicationNumber: z.string().min(1),
});

statusCheckAdminRouter.post(
  '/verify',
  authenticate,
  authorize({ resource: 'loan_applications', action: 'read' }),
  async (req, res, next) => {
    try {
      const input = VerifySchema.parse(req.body);
      const pool = getPool();

      const [[otpRow]] = await pool.execute(
        `SELECT id FROM status_check_otps
         WHERE email = :email AND otp_hash = :hash AND verified_at IS NULL AND expires_at > NOW(3)
         ORDER BY created_at DESC LIMIT 1`,
        { email: input.email, hash: hashOtp(input.otp) },
      );
      if (!otpRow) {
        return res.status(401).json({ error: 'Invalid or expired OTP' });
      }

      await pool.execute(`UPDATE status_check_otps SET verified_at = NOW(3) WHERE id = :id`, {
        id: otpRow.id,
      });

      const [[row]] = await pool.execute(
        `SELECT la.id, la.application_number, la.status, la.eligibility_status,
                la.status_notes, la.updated_at, la.created_at, la.requested_loan_amount,
                la.loan_purpose, la.data,
                up.email AS customer_email, up.full_name AS customer_name, up.phone AS customer_phone
         FROM loan_applications la
         JOIN user_profiles up ON up.id = la.customer_id
         WHERE up.email = :email AND la.application_number = :num LIMIT 1`,
        { email: input.email, num: input.applicationNumber },
      );

      if (!row) {
        return res.status(404).json({ error: 'Application not found' });
      }

      res.json({ application: formatApplication(row) });
    } catch (err) {
      next(err);
    }
  },
);
