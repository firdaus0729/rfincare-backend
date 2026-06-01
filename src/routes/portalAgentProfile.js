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
import { ensureAgentProfileSchema } from '../db/ensureAgentProfileSchema.js';
import { backfillMissingAgentCodes, ensureAgentCodeForUser } from '../lib/agentCode.js';

export const portalAgentProfileRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function maskPhone(phone) {
  const p = normalizePhone(phone);
  if (p.length < 4) return '—';
  return `+91 ******${p.slice(-4)}`;
}

function maskAccount(account) {
  const s = String(account || '');
  if (s.length <= 4) return '****';
  return `****${s.slice(-4)}`;
}

function requireAgent(req) {
  if (req.auth.role !== 'agent' && !['admin', 'super_admin'].includes(req.auth.role)) {
    const e = new Error('Agent access only');
    e.status = 403;
    throw e;
  }
}

async function loadAgentContext(pool, userId) {
  const [[row]] = await pool.execute(
    `SELECT up.id, up.email, up.full_name, up.phone, up.avatar_url, up.is_active, up.account_status,
            ao.agent_code, ao.username, ao.mobile_number, ao.account_number, ao.bank_name, ao.ifsc_code,
            ao.onboarding_status
     FROM user_profiles up
     LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
     WHERE up.id = :id AND up.role = 'agent'
     LIMIT 1`,
    { id: userId },
  );
  if (!row) {
    const e = new Error('Agent profile not found');
    e.status = 404;
    throw e;
  }
  return row;
}

async function storeOtp(pool, { agentUserId, purpose, channel, email, phone, payload }) {
  const otp = generateOtp();
  const id = newId();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await pool.execute(
    `INSERT INTO agent_profile_otps
     (id, agent_user_id, purpose, channel, target_email, target_phone, otp_hash, payload, expires_at)
     VALUES (:id, :uid, :purpose, :channel, :email, :phone, :hash, :payload, :exp)`,
    {
      id,
      uid: agentUserId,
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

async function verifyLatestOtp(pool, { agentUserId, purpose, otp }) {
  const [[row]] = await pool.execute(
    `SELECT id, payload FROM agent_profile_otps
     WHERE agent_user_id = :uid AND purpose = :purpose AND otp_hash = :hash
       AND verified_at IS NULL AND expires_at > NOW(3)
     ORDER BY created_at DESC LIMIT 1`,
    { uid: agentUserId, purpose, hash: hashOtp(otp) },
  );
  if (!row) return null;
  await pool.execute(`UPDATE agent_profile_otps SET verified_at = NOW(3) WHERE id = :id`, { id: row.id });
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

const uploadRoot = process.env.UPLOAD_DIR || './uploads';
const avatarDir = resolve(uploadRoot, 'agent-avatars');
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

portalAgentProfileRouter.use(authenticate);

portalAgentProfileRouter.get('/', async (req, res, next) => {
  try {
    requireAgent(req);
    await ensureAgentProfileSchema();
    const pool = getPool();
    await backfillMissingAgentCodes(pool);
    const row = await loadAgentContext(pool, req.auth.userId);
    const agentCode = (await ensureAgentCodeForUser(pool, req.auth.userId)) || row.agent_code;
    const mobile = row.mobile_number || row.phone;

    res.json({
      profile: {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        avatarUrl: row.avatar_url,
        agentCode,
        username: row.username,
        isActive: Boolean(row.is_active),
        accountStatus: row.account_status,
        onboardingStatus: row.onboarding_status,
      },
      bank: {
        accountNumber: row.account_number,
        accountNumberMasked: maskAccount(row.account_number),
        bankName: row.bank_name,
        ifscCode: row.ifsc_code,
      },
      maskedMobile: maskPhone(mobile),
      registeredMobile: mobile,
      registeredEmail: row.email,
    });
  } catch (err) {
    next(err);
  }
});

portalAgentProfileRouter.post('/photo', avatarUpload.single('photo'), async (req, res, next) => {
  try {
    requireAgent(req);
    if (!req.file) return res.status(400).json({ error: 'Photo file is required' });
    await ensureAgentProfileSchema();
    const avatarUrl = `/uploads/agent-avatars/${req.file.filename}`;
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

const BankOtpSchema = z.object({
  accountNumber: z.string().min(4),
  bankName: z.string().min(2),
  ifscCode: z.string().min(8).max(16),
});

portalAgentProfileRouter.post('/bank/request-otp', async (req, res, next) => {
  try {
    requireAgent(req);
    const input = BankOtpSchema.parse(req.body);
    await ensureAgentProfileSchema();
    const pool = getPool();
    const row = await loadAgentContext(pool, req.auth.userId);
    const phone = normalizePhone(row.mobile_number || row.phone);
    if (!phone) return res.status(400).json({ error: 'No registered mobile on file' });

    const { otp } = await storeOtp(pool, {
      agentUserId: req.auth.userId,
      purpose: 'bank_update',
      channel: 'sms',
      phone,
      email: row.email,
      payload: input,
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

portalAgentProfileRouter.post('/bank/confirm', async (req, res, next) => {
  try {
    requireAgent(req);
    const input = z
      .object({
        otp: z.string().length(6),
        accountNumber: z.string().min(4),
        bankName: z.string().min(2),
        ifscCode: z.string().min(8).max(16),
      })
      .parse(req.body);

    await ensureAgentProfileSchema();
    const pool = getPool();
    const verified = await verifyLatestOtp(pool, {
      agentUserId: req.auth.userId,
      purpose: 'bank_update',
      otp: input.otp,
    });
    if (!verified) return res.status(401).json({ error: 'Invalid or expired OTP' });

    await pool.execute(
      `UPDATE agent_onboarding
       SET account_number = :acct, bank_name = :bank, ifsc_code = :ifsc, updated_at = NOW(3)
       WHERE user_id = :id`,
      {
        id: req.auth.userId,
        acct: input.accountNumber.trim(),
        bank: input.bankName.trim(),
        ifsc: input.ifscCode.trim().toUpperCase(),
      },
    );

    res.json({ success: true, message: 'Commission bank details updated' });
  } catch (err) {
    next(err);
  }
});

const EmailOtpSchema = z.object({ newEmail: z.string().email() });

portalAgentProfileRouter.post('/email/request-otp', async (req, res, next) => {
  try {
    requireAgent(req);
    const { newEmail } = EmailOtpSchema.parse(req.body);
    await ensureAgentProfileSchema();
    const pool = getPool();
    const row = await loadAgentContext(pool, req.auth.userId);
    const phone = normalizePhone(row.mobile_number || row.phone);
    if (!phone) return res.status(400).json({ error: 'No registered mobile on file' });

    const [[existing]] = await pool.execute(
      `SELECT id FROM auth_users WHERE email = :email AND id != :id LIMIT 1`,
      { email: newEmail, id: req.auth.userId },
    );
    if (existing) return res.status(409).json({ error: 'Email is already in use' });

    const { otp } = await storeOtp(pool, {
      agentUserId: req.auth.userId,
      purpose: 'email_update',
      channel: 'sms',
      phone,
      email: row.email,
      payload: { newEmail },
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

portalAgentProfileRouter.post('/email/confirm', async (req, res, next) => {
  try {
    requireAgent(req);
    const input = z.object({ otp: z.string().length(6), newEmail: z.string().email() }).parse(req.body);
    await ensureAgentProfileSchema();
    const pool = getPool();
    const verified = await verifyLatestOtp(pool, {
      agentUserId: req.auth.userId,
      purpose: 'email_update',
      otp: input.otp,
    });
    if (!verified) return res.status(401).json({ error: 'Invalid or expired OTP' });

    const newEmail =
      verified.payload?.newEmail === input.newEmail ? input.newEmail : input.newEmail;
    if (verified.payload?.newEmail && verified.payload.newEmail !== input.newEmail) {
      return res.status(400).json({ error: 'Email does not match OTP request' });
    }

    const [[existing]] = await pool.execute(
      `SELECT id FROM auth_users WHERE email = :email AND id != :id LIMIT 1`,
      { email: newEmail, id: req.auth.userId },
    );
    if (existing) return res.status(409).json({ error: 'Email is already in use' });

    await pool.execute(`UPDATE auth_users SET email = :email WHERE id = :id`, {
      email: newEmail,
      id: req.auth.userId,
    });
    await pool.execute(`UPDATE user_profiles SET email = :email WHERE id = :id`, {
      email: newEmail,
      id: req.auth.userId,
    });
    await pool.execute(`UPDATE agent_onboarding SET email = :email WHERE user_id = :id`, {
      email: newEmail,
      id: req.auth.userId,
    });

    res.json({ success: true, email: newEmail });
  } catch (err) {
    next(err);
  }
});

portalAgentProfileRouter.post('/password-reset/request-otp', async (req, res, next) => {
  try {
    requireAgent(req);
    await ensureAgentProfileSchema();
    const pool = getPool();
    const row = await loadAgentContext(pool, req.auth.userId);

    const { otp } = await storeOtp(pool, {
      agentUserId: req.auth.userId,
      purpose: 'password_reset',
      channel: 'email',
      email: row.email,
      phone: normalizePhone(row.mobile_number || row.phone),
      payload: null,
    });

    await sendOtpNotification({ email: row.email, otp, channel: 'email' });
    res.json({
      success: true,
      message: 'OTP sent to your registered email',
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

portalAgentProfileRouter.post('/password-reset/confirm', async (req, res, next) => {
  try {
    requireAgent(req);
    const input = PasswordResetConfirmSchema.parse(req.body);
    await ensureAgentProfileSchema();
    const pool = getPool();
    const verified = await verifyLatestOtp(pool, {
      agentUserId: req.auth.userId,
      purpose: 'password_reset',
      otp: input.otp,
    });
    if (!verified) return res.status(401).json({ error: 'Invalid or expired OTP' });

    const hashed = await bcrypt.hash(input.newPassword, 12);
    await pool.execute(`UPDATE auth_users SET password_hash = :ph WHERE id = :id`, {
      ph: hashed,
      id: req.auth.userId,
    });

    res.json({ success: true, message: 'Password updated. Please sign in again.' });
  } catch (err) {
    next(err);
  }
});

portalAgentProfileRouter.post('/deactivate/request-otp', async (req, res, next) => {
  try {
    requireAgent(req);
    await ensureAgentProfileSchema();
    const pool = getPool();
    const row = await loadAgentContext(pool, req.auth.userId);
    const phone = normalizePhone(row.mobile_number || row.phone);
    if (!phone) return res.status(400).json({ error: 'No registered mobile on file' });

    const { otp } = await storeOtp(pool, {
      agentUserId: req.auth.userId,
      purpose: 'deactivate',
      channel: 'sms',
      phone,
      email: row.email,
      payload: null,
    });

    await sendOtpNotification({ phone, email: row.email, otp, channel: 'sms' });
    res.json({
      success: true,
      message: 'OTP sent to confirm deactivation',
      expiresInSeconds: 600,
      ...(process.env.LOG_OTP === 'true' ? { devOtp: otp } : {}),
    });
  } catch (err) {
    next(err);
  }
});

portalAgentProfileRouter.post('/deactivate/confirm', async (req, res, next) => {
  try {
    requireAgent(req);
    const input = z
      .object({
        otp: z.string().length(6),
        confirmText: z.literal('DEACTIVATE'),
      })
      .parse(req.body);

    await ensureAgentProfileSchema();
    const pool = getPool();
    const verified = await verifyLatestOtp(pool, {
      agentUserId: req.auth.userId,
      purpose: 'deactivate',
      otp: input.otp,
    });
    if (!verified) return res.status(401).json({ error: 'Invalid or expired OTP' });

    await pool.execute(
      `UPDATE user_profiles
       SET is_active = 0, account_status = 'inactive', onboarding_status = 'deactivated'
       WHERE id = :id`,
      { id: req.auth.userId },
    );
    await pool.execute(
      `UPDATE agent_onboarding SET onboarding_status = 'deactivated' WHERE user_id = :id`,
      { id: req.auth.userId },
    );
    await pool.execute(
      `UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = :id AND revoked_at IS NULL`,
      { id: req.auth.userId },
    );

    res.json({
      success: true,
      message: 'Your agent code and account have been deactivated.',
    });
  } catch (err) {
    next(err);
  }
});
