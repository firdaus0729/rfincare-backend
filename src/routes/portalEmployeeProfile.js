import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';
import { generateOtp, hashOtp, sendOtpNotification } from '../lib/otp.js';
import { ensureEmployeeProfileSchema } from '../db/ensureEmployeeProfileSchema.js';

export const portalEmployeeProfileRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;

const uploadRoot = process.env.UPLOAD_DIR || './uploads';
const avatarDir = resolve(uploadRoot, 'employee-avatars');
mkdirSync(avatarDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => {
      const safe = `${req.auth.userId}-${Date.now()}${extname(file.originalname)}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function maskPhone(phone) {
  const p = normalizePhone(phone);
  if (p.length < 4) return '—';
  return `+91 ******${p.slice(-4)}`;
}

function requireEmployee(req) {
  if (req.auth.role !== 'employee' && !['admin', 'super_admin'].includes(req.auth.role)) {
    const e = new Error('Employee access only');
    e.status = 403;
    throw e;
  }
}

async function loadEmployeeContext(pool, userId) {
  const [[row]] = await pool.execute(
    `SELECT up.id, up.email, up.full_name, up.phone, up.avatar_url, up.is_active, up.account_status,
            eo.employee_code, eo.username, eo.mobile_number, eo.employee_name,
            eo.onboarding_status
     FROM user_profiles up
     LEFT JOIN employee_onboarding eo ON eo.user_id = up.id
     WHERE up.id = :id AND up.role = 'employee'
     LIMIT 1`,
    { id: userId },
  );
  if (!row) {
    const e = new Error('Employee profile not found');
    e.status = 404;
    throw e;
  }
  return row;
}

async function storeOtp(pool, { employeeUserId, purpose, channel, email, phone, payload }) {
  const otp = generateOtp();
  const id = newId();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await pool.execute(
    `INSERT INTO employee_profile_otps
     (id, employee_user_id, purpose, channel, target_email, target_phone, otp_hash, payload, expires_at)
     VALUES (:id, :uid, :purpose, :channel, :email, :phone, :hash, :payload, :exp)`,
    {
      id,
      uid: employeeUserId,
      purpose,
      channel,
      email: email || null,
      phone: phone || null,
      hash: hashOtp(otp),
      payload: payload ? JSON.stringify(payload) : null,
      exp: expiresAt,
    },
  );
  return { otp, id, expiresAt };
}

async function verifyLatestOtp(pool, { employeeUserId, purpose, otp }) {
  const [[row]] = await pool.execute(
    `SELECT id, payload FROM employee_profile_otps
     WHERE employee_user_id = :uid AND purpose = :purpose AND otp_hash = :hash
       AND verified_at IS NULL AND expires_at > NOW(3)
     ORDER BY created_at DESC LIMIT 1`,
    { uid: employeeUserId, purpose, hash: hashOtp(otp) },
  );
  if (!row) return null;
  await pool.execute(`UPDATE employee_profile_otps SET verified_at = NOW(3) WHERE id = :id`, { id: row.id });
  let payload = null;
  if (row.payload) {
    try {
      payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    } catch {
      payload = null;
    }
  }
  return { id: row.id, payload };
}

portalEmployeeProfileRouter.use(authenticate);

portalEmployeeProfileRouter.get('/', async (req, res, next) => {
  try {
    requireEmployee(req);
    await ensureEmployeeProfileSchema();
    const pool = getPool();
    const row = await loadEmployeeContext(pool, req.auth.userId);
    const mobile = row.mobile_number || row.phone;

    res.json({
      profile: {
        id: row.id,
        fullName: row.full_name || row.employee_name,
        email: row.email,
        phone: row.phone,
        avatarUrl: row.avatar_url,
        employeeCode: row.employee_code,
        username: row.username,
        isActive: Boolean(row.is_active),
        accountStatus: row.account_status,
        onboardingStatus: row.onboarding_status,
      },
      maskedMobile: maskPhone(mobile),
      registeredMobile: mobile,
      registeredEmail: row.email,
    });
  } catch (err) {
    next(err);
  }
});

portalEmployeeProfileRouter.post('/photo', avatarUpload.single('photo'), async (req, res, next) => {
  try {
    requireEmployee(req);
    if (!req.file) return res.status(400).json({ error: 'Photo file is required' });
    await ensureEmployeeProfileSchema();
    const avatarUrl = `/uploads/employee-avatars/${req.file.filename}`;
    const pool = getPool();
    await pool.execute(`UPDATE user_profiles SET avatar_url = :url WHERE id = :id`, {
      url: avatarUrl,
      id: req.auth.userId,
    });
    res.json({ success: true, avatarUrl });
  } catch (err) {
    next(err);
  }
});

portalEmployeeProfileRouter.post('/password-reset/request-otp', async (req, res, next) => {
  try {
    requireEmployee(req);
    await ensureEmployeeProfileSchema();
    const pool = getPool();
    const row = await loadEmployeeContext(pool, req.auth.userId);
    const phone = normalizePhone(row.mobile_number || row.phone);
    if (!phone) return res.status(400).json({ error: 'No registered mobile on file' });

    const { otp } = await storeOtp(pool, {
      employeeUserId: req.auth.userId,
      purpose: 'password_reset',
      channel: 'sms',
      phone,
      email: row.email,
      payload: null,
    });

    await sendOtpNotification({ phone, email: row.email, otp, channel: 'sms' });
    res.json({
      success: true,
      message: 'OTP sent to your registered mobile number',
      expiresInSeconds: 600,
      ...(process.env.LOG_OTP === 'true' ? { devOtp: otp } : {}),
    });
  } catch (err) {
    next(err);
  }
});

const PasswordResetConfirmSchema = z.object({
  otp: z.string().length(6),
  newPassword: z.string().min(8),
});

portalEmployeeProfileRouter.post('/password-reset/confirm', async (req, res, next) => {
  try {
    requireEmployee(req);
    const input = PasswordResetConfirmSchema.parse(req.body);
    await ensureEmployeeProfileSchema();
    const pool = getPool();
    const verified = await verifyLatestOtp(pool, {
      employeeUserId: req.auth.userId,
      purpose: 'password_reset',
      otp: input.otp,
    });
    if (!verified) return res.status(401).json({ error: 'Invalid or expired OTP' });

    const hashed = await bcrypt.hash(input.newPassword, 12);
    await pool.execute(`UPDATE auth_users SET password_hash = :ph WHERE id = :id`, {
      ph: hashed,
      id: req.auth.userId,
    });
    await pool.execute(
      `UPDATE user_profiles SET password_change_required = 0 WHERE id = :id`,
      { id: req.auth.userId },
    );

    res.json({ success: true, message: 'Password updated. Please sign in again.' });
  } catch (err) {
    next(err);
  }
});
