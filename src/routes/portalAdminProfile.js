import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { z } from 'zod';

import { authenticate } from '../middleware/authenticate.js';
import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { generateOtp, hashOtp, sendOtpNotification } from '../lib/otp.js';
import { ensureAdminProfileSchema } from '../db/ensureAdminProfileSchema.js';
import {
  collectOtpRecipientEmails,
  getAdminVerifierEmails,
  maskEmail,
  saveAdminVerifierEmails,
} from '../lib/adminVerificationEmails.js';
import { getUploadDir } from '../lib/uploadPaths.js';

export const portalAdminProfileRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;

const avatarDir = resolve(getUploadDir(), 'admin-avatars');
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

function requireAdmin(req) {
  if (!['admin', 'super_admin'].includes(req.auth.role)) {
    const e = new Error('Admin access only');
    e.status = 403;
    throw e;
  }
}

async function loadAdminContext(pool, userId) {
  const [[row]] = await pool.execute(
    `SELECT id, email, full_name, phone, avatar_url, role, is_active, account_status
     FROM user_profiles
     WHERE id = :id AND role IN ('admin', 'super_admin')
     LIMIT 1`,
    { id: userId },
  );
  if (!row) {
    const e = new Error('Admin profile not found');
    e.status = 404;
    throw e;
  }
  return row;
}

async function storeOtp(pool, { adminUserId, purpose, email, payload }) {
  const otp = generateOtp();
  const id = newId();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await pool.execute(
    `INSERT INTO admin_profile_otps
     (id, admin_user_id, purpose, channel, target_email, otp_hash, payload, expires_at)
     VALUES (:id, :uid, :purpose, 'email', :email, :hash, :payload, :exp)`,
    {
      id,
      uid: adminUserId,
      purpose,
      email: email || null,
      hash: hashOtp(otp),
      payload: payload ? JSON.stringify(payload) : null,
      exp: expiresAt,
    },
  );
  return { otp, id, expiresAt };
}

async function verifyLatestOtp(pool, { adminUserId, purpose, otp }) {
  const [[row]] = await pool.execute(
    `SELECT id FROM admin_profile_otps
     WHERE admin_user_id = :uid AND purpose = :purpose AND otp_hash = :hash
       AND verified_at IS NULL AND expires_at > NOW(3)
     ORDER BY created_at DESC LIMIT 1`,
    { uid: adminUserId, purpose, hash: hashOtp(otp) },
  );
  if (!row) return false;
  await pool.execute(`UPDATE admin_profile_otps SET verified_at = NOW(3) WHERE id = :id`, {
    id: row.id,
  });
  return true;
}

async function sendOtpToRecipients(recipients, otp) {
  const unique = [...new Set(recipients.filter(Boolean))];
  await Promise.all(
    unique.map((email) => sendOtpNotification({ email, otp, channel: 'email' })),
  );
  return unique;
}

portalAdminProfileRouter.use(authenticate);

portalAdminProfileRouter.get('/', async (req, res, next) => {
  try {
    requireAdmin(req);
    await ensureAdminProfileSchema();
    const pool = getPool();
    const row = await loadAdminContext(pool, req.auth.userId);
    const verifiers = await getAdminVerifierEmails();

    res.json({
      profile: {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        avatarUrl: row.avatar_url,
        role: row.role,
        isActive: Boolean(row.is_active),
        accountStatus: row.account_status,
      },
      registeredEmail: row.email,
      maskedEmail: maskEmail(row.email),
      verificationEmails: verifiers.map((email) => ({
        email,
        masked: maskEmail(email),
      })),
      canManageVerificationEmails: req.auth.role === 'super_admin',
    });
  } catch (err) {
    next(err);
  }
});

portalAdminProfileRouter.put('/verification-emails', async (req, res, next) => {
  try {
    requireAdmin(req);
    if (req.auth.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admin can update verification emails' });
    }

    const input = z
      .object({
        emails: z.array(z.string().email()).length(3),
      })
      .parse(req.body);

    const saved = await saveAdminVerifierEmails(input.emails, req.auth.userId);
    res.json({
      success: true,
      verificationEmails: saved.map((email) => ({ email, masked: maskEmail(email) })),
    });
  } catch (err) {
    next(err);
  }
});

portalAdminProfileRouter.post('/photo', avatarUpload.single('photo'), async (req, res, next) => {
  try {
    requireAdmin(req);
    if (!req.file) return res.status(400).json({ error: 'Photo file is required' });

    const avatarUrl = `/uploads/admin-avatars/${req.file.filename}`;
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

portalAdminProfileRouter.post('/password-reset/request-otp', async (req, res, next) => {
  try {
    requireAdmin(req);
    await ensureAdminProfileSchema();
    const pool = getPool();
    const row = await loadAdminContext(pool, req.auth.userId);
    if (!row.email) {
      return res.status(400).json({ error: 'No registered email on your admin profile' });
    }

    const { recipients, verifiers } = await collectOtpRecipientEmails(row.email);
    if (verifiers.length < 3) {
      return res.status(400).json({
        error:
          'All three verifier emails must be configured in Settings (super admin) or via ADMIN_VERIFIER_EMAIL_1/2/3',
      });
    }

    const { otp } = await storeOtp(pool, {
      adminUserId: req.auth.userId,
      purpose: 'password_reset',
      email: row.email,
      payload: { recipients },
    });

    await sendOtpToRecipients(recipients, otp);

    res.json({
      success: true,
      message: `OTP sent to ${recipients.length} registered email address(es)`,
      recipientCount: recipients.length,
      maskedRecipients: recipients.map(maskEmail),
      verifierCount: verifiers.length,
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

portalAdminProfileRouter.post('/password-reset/confirm', async (req, res, next) => {
  try {
    requireAdmin(req);
    const input = PasswordResetConfirmSchema.parse(req.body);
    await ensureAdminProfileSchema();
    const pool = getPool();

    const verified = await verifyLatestOtp(pool, {
      adminUserId: req.auth.userId,
      purpose: 'password_reset',
      otp: input.otp,
    });
    if (!verified) return res.status(401).json({ error: 'Invalid or expired OTP' });

    const hashed = await bcrypt.hash(input.newPassword, 12);
    await pool.execute(`UPDATE auth_users SET password_hash = :ph WHERE id = :id`, {
      ph: hashed,
      id: req.auth.userId,
    });
    await pool.execute(`UPDATE user_profiles SET password_change_required = 0 WHERE id = :id`, {
      id: req.auth.userId,
    });

    res.json({ success: true, message: 'Password updated. Please sign in again.' });
  } catch (err) {
    next(err);
  }
});
