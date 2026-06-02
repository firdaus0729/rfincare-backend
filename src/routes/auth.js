import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { sha256Hex } from '../lib/crypto.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { getSessionCookieOptions } from '../lib/cookieOptions.js';
import { generateOtp, hashOtp, sendOtpNotification } from '../lib/otp.js';
import { assignUniqueCustomerCode } from '../lib/customerCode.js';
import { ensureMilestone3Schema } from '../db/ensureMilestone3Schema.js';
import { writeAuditLog } from '../lib/audit.js';

export const authRouter = Router();

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1).optional(),
  phone: z.string().min(6).optional(),
  role: z.enum(['customer', 'agent', 'employee', 'admin', 'super_admin']).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString()?.split(',')?.[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

function refreshCookieMaxAge() {
  return Number(process.env.JWT_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 30) * 1000;
}

function setRefreshCookie(res, token) {
  res.cookie('refresh_token', token, getSessionCookieOptions('/auth/refresh', refreshCookieMaxAge()));
}

function clearRefreshCookie(res) {
  const opts = getSessionCookieOptions('/auth/refresh', 0);
  res.clearCookie('refresh_token', { path: opts.path, secure: opts.secure, sameSite: opts.sameSite });
}

async function issueTokens({ userId, email, role, req }) {
  const pool = getPool();
  const tokenId = newId();
  const refreshJwt = signRefreshToken({ tokenId, userId });
  const refreshHash = sha256Hex(refreshJwt);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Number(process.env.JWT_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 30) * 1000);

  await pool.execute(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, issued_at, expires_at, user_agent, ip_address)
     VALUES (:id, :userId, :tokenHash, :issuedAt, :expiresAt, :ua, :ip)`,
    {
      id: tokenId,
      userId,
      tokenHash: refreshHash,
      issuedAt: now,
      expiresAt,
      ua: req.headers['user-agent']?.toString()?.slice(0, 512) ?? null,
      ip: getClientIp(req),
    },
  );

  const accessJwt = signAccessToken({ userId, email, role });
  return { accessJwt, refreshJwt };
}

authRouter.post('/signup', async (req, res, next) => {
  try {
    const input = SignupSchema.parse(req.body);
    const pool = getPool();
    const userId = newId();
    const passwordHash = await bcrypt.hash(input.password, 12);

    const role = input.role || 'customer';

    await pool.execute(
      `INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)`,
      { id: userId, email: input.email, ph: passwordHash },
    );

    await ensureMilestone3Schema();
    await pool.execute(
      `INSERT INTO user_profiles (id, email, full_name, phone, role, account_status, is_active)
       VALUES (:id, :email, :fullName, :phone, :role, 'active', 1)`,
      {
        id: userId,
        email: input.email,
        fullName: input.fullName ?? null,
        phone: input.phone ?? null,
        role,
      },
    );

    if (role === 'customer') {
      await assignUniqueCustomerCode(pool, userId);
    }

    const { accessJwt, refreshJwt } = await issueTokens({ userId, email: input.email, role, req });
    setRefreshCookie(res, refreshJwt);

    res.status(201).json({
      accessToken: accessJwt,
      user: { id: userId, email: input.email, role },
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      err.status = 409;
      err.message = 'Email already exists';
    }
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const input = LoginSchema.parse(req.body);
    const pool = getPool();

    const [[userRow]] = await pool.execute(
      `SELECT id, email, password_hash FROM auth_users WHERE email = :email LIMIT 1`,
      { email: input.email },
    );

    if (!userRow) {
      const e = new Error('Invalid email or password');
      e.status = 401;
      throw e;
    }

    const [[profile]] = await pool.execute(
      `SELECT id, role, account_status, is_active, failed_login_attempts, locked_until
       FROM user_profiles WHERE id = :id LIMIT 1`,
      { id: userRow.id },
    );

    if (!profile || !profile.is_active) {
      const e = new Error('Account is inactive. Please contact administrator.');
      e.status = 403;
      throw e;
    }
    if (profile.account_status === 'suspended') {
      const e = new Error('Account is suspended. Please contact administrator.');
      e.status = 403;
      throw e;
    }

    const lockStillActive =
      profile.locked_until && new Date(profile.locked_until) > new Date();
    const lockExpired =
      profile.locked_until && new Date(profile.locked_until) <= new Date();

    if (profile.account_status === 'locked' && (lockExpired || !profile.locked_until)) {
      await pool.execute(
        `UPDATE user_profiles
         SET account_status = 'active', failed_login_attempts = 0, locked_until = NULL
         WHERE id = :id`,
        { id: profile.id },
      );
      profile.account_status = 'active';
      profile.failed_login_attempts = 0;
      profile.locked_until = null;
    }

    if (lockStillActive) {
      const e = new Error('Account is temporarily locked. Please try again in a few minutes.');
      e.status = 403;
      throw e;
    }
    if (profile.account_status === 'locked') {
      const e = new Error('Account is locked due to multiple failed login attempts.');
      e.status = 403;
      throw e;
    }

    const ok = await bcrypt.compare(input.password, userRow.password_hash);
    if (!ok) {
      const attempts = Number(profile?.failed_login_attempts || 0) + 1;
      const updates = { attempts, locked: 0, lockedUntil: null };
      if (attempts >= 5) {
        updates.locked = 1;
        updates.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
      }

      await pool.execute(
        `UPDATE user_profiles
         SET failed_login_attempts = :attempts,
             account_status = IF(:locked = 1, 'locked', account_status),
             locked_until = :lockedUntil
         WHERE id = :id`,
        { attempts: updates.attempts, locked: updates.locked, lockedUntil: updates.lockedUntil, id: profile.id },
      );

      const e = new Error('Invalid email or password');
      e.status = 401;
      throw e;
    }

    await pool.execute(
      `UPDATE user_profiles
       SET failed_login_attempts = 0,
           locked_until = NULL,
           account_status = IF(account_status = 'locked', 'active', account_status)
       WHERE id = :id`,
      { id: profile.id },
    );

    const { accessJwt, refreshJwt } = await issueTokens({
      userId: profile.id,
      email: userRow.email,
      role: profile.role,
      req,
    });
    setRefreshCookie(res, refreshJwt);

    res.json({
      accessToken: accessJwt,
      user: { id: profile.id, email: userRow.email, role: profile.role },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.refresh_token || req.body?.refreshToken;
    if (!token) {
      const e = new Error('Missing refresh token');
      e.status = 401;
      throw e;
    }

    const payload = verifyRefreshToken(token);
    const userId = payload.sub;
    const tokenId = payload.jti;

    const pool = getPool();
    const refreshHash = sha256Hex(token);

    const [[row]] = await pool.execute(
      `SELECT id, user_id, expires_at, revoked_at, rotated_to_token_id
       FROM refresh_tokens
       WHERE id = :id AND user_id = :userId AND token_hash = :tokenHash
       LIMIT 1`,
      { id: tokenId, userId, tokenHash: refreshHash },
    );

    if (!row || row.revoked_at || row.rotated_to_token_id) {
      const e = new Error('Refresh token is no longer valid');
      e.status = 401;
      throw e;
    }
    if (new Date(row.expires_at) < new Date()) {
      const e = new Error('Refresh token expired');
      e.status = 401;
      throw e;
    }

    const [[profile]] = await pool.execute(
      `SELECT id, email, role, account_status, is_active
       FROM user_profiles WHERE id = :id LIMIT 1`,
      { id: userId },
    );
    if (!profile || !profile.is_active || profile.account_status !== 'active') {
      const e = new Error('Account is not active');
      e.status = 403;
      throw e;
    }

    // rotate refresh token
    const newTokenId = newId();
    const newRefreshJwt = signRefreshToken({ tokenId: newTokenId, userId });
    const newHash = sha256Hex(newRefreshJwt);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Number(process.env.JWT_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 30) * 1000);

    await pool.execute(
      `UPDATE refresh_tokens SET revoked_at = :revokedAt, rotated_to_token_id = :rotatedTo WHERE id = :id`,
      { revokedAt: now, rotatedTo: newTokenId, id: tokenId },
    );
    await pool.execute(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, issued_at, expires_at, user_agent, ip_address)
       VALUES (:id, :userId, :tokenHash, :issuedAt, :expiresAt, :ua, :ip)`,
      {
        id: newTokenId,
        userId,
        tokenHash: newHash,
        issuedAt: now,
        expiresAt,
        ua: req.headers['user-agent']?.toString()?.slice(0, 512) ?? null,
        ip: getClientIp(req),
      },
    );

    const accessJwt = signAccessToken({ userId, email: profile.email, role: profile.role });
    setRefreshCookie(res, newRefreshJwt);

    res.json({ accessToken: accessJwt });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.refresh_token || req.body?.refreshToken;
    if (token) {
      try {
        const payload = verifyRefreshToken(token);
        const pool = getPool();
        await pool.execute(
          `UPDATE refresh_tokens SET revoked_at = :now WHERE id = :id AND user_id = :userId`,
          { now: new Date(), id: payload.jti, userId: payload.sub },
        );
      } catch {
        // ignore invalid token during logout
      }
    }

    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    if (!token) {
      const e = new Error('Missing access token');
      e.status = 401;
      throw e;
    }

    // lazy import to avoid circular deps
    const { verifyAccessToken } = await import('../lib/jwt.js');
    const payload = verifyAccessToken(token);
    const pool = getPool();

    const [[profile]] = await pool.execute(
      `SELECT * FROM user_profiles WHERE id = :id LIMIT 1`,
      { id: payload.sub },
    );

    if (!profile) {
      const e = new Error('User profile not found');
      e.status = 404;
      throw e;
    }

    res.json({ user: { id: profile.id, email: profile.email }, profile });
  } catch (err) {
    next(err);
  }
});

/**
 * CUSTOMER REGISTRATION PORTAL FLOW
 */

// Initiate registration from the portal (no password yet)
authRouter.post('/register-portal', async (req, res, next) => {
  try {
    const pool = getPool();
    const id = newId();
    const data = req.body;

    await pool.execute(
      `INSERT INTO customer_registrations (
        id, email, full_name, phone, oauth_provider, oauth_provider_id, 
        date_of_birth, gender, address_line1, address_line2, city, state, 
        pin_code, employment_type, employer_name, annual_income, bank_name, 
        account_name, registration_status
      ) VALUES (
        :id, :email, :full_name, :phone, :oauth_provider, :oauth_provider_id,
        :date_of_birth, :gender, :address_line1, :address_line2, :city, :state,
        :pin_code, :employment_type, :employer_name, :annual_income, :bank_name,
        :account_name, 'pending'
      )`,
      {
        id,
        email: data.email,
        full_name: data.fullName || data.full_name,
        phone: data.phone,
        oauth_provider: data.oauthProvider || data.oauth_provider || 'email',
        oauth_provider_id: data.oauthProviderId || data.oauth_provider_id || null,
        date_of_birth: data.dateOfBirth || data.date_of_birth || null,
        gender: data.gender || null,
        address_line1: data.addressLine1 || data.address_line1 || null,
        address_line2: data.addressLine2 || data.address_line2 || null,
        city: data.city || null,
        state: data.state || null,
        pin_code: data.pinCode || data.pin_code || null,
        employment_type: data.employmentType || data.employment_type || null,
        employer_name: data.employerName || data.employer_name || null,
        annual_income: data.annualIncome || data.annual_income || null,
        bank_name: data.bankName || data.bank_name || null,
        account_name: data.accountName || data.account_name || null,
      }
    );

    res.status(201).json({ id, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// Admin: List pending registrations
authRouter.get('/registrations', authenticate, authorize({ resource: 'registration', action: 'read' }), async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT * FROM customer_registrations ORDER BY created_at DESC`
    );
    res.json({ registrations: rows });
  } catch (err) {
    next(err);
  }
});

// Admin: Approve registration
authRouter.post('/registrations/:id/approve', authenticate, authorize({ resource: 'registration', action: 'update' }), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const pool = getPool();

    const [[reg]] = await pool.execute(
      `SELECT * FROM customer_registrations WHERE id = :id LIMIT 1`,
      { id }
    );

    if (!reg) {
      const e = new Error('Registration not found');
      e.status = 404;
      throw e;
    }

    // Create auth user
    const userId = newId();
    const passwordHash = await bcrypt.hash(password || 'Temporary@123', 12);

    await pool.execute(
      `INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)`,
      { id: userId, email: reg.email, ph: passwordHash }
    );

    await ensureMilestone3Schema();
    await pool.execute(
      `INSERT INTO user_profiles (id, email, full_name, phone, role, account_status, is_active)
       VALUES (:id, :email, :fullName, :phone, 'customer', 'active', 1)`,
      { id: userId, email: reg.email, fullName: reg.full_name, phone: reg.phone },
    );

    const customerCode = await assignUniqueCustomerCode(pool, userId);

    await pool.execute(
      `UPDATE customer_registrations 
       SET registration_status = 'approved', reviewed_by = :reviewerId, approved_at = NOW()
       WHERE id = :id`,
      { id, reviewerId: req.auth.userId },
    );

    await writeAuditLog({
      userId: req.auth.userId,
      actionType: 'APPROVE',
      tableName: 'user_profiles',
      recordId: userId,
      newValues: { customerCode, email: reg.email },
    });

    res.json({ success: true, userId, customerCode });
  } catch (err) {
    next(err);
  }
});

// Admin: Reject registration
authRouter.post('/registrations/:id/reject', authenticate, authorize({ resource: 'registration', action: 'update' }), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const pool = getPool();

    await pool.execute(
      `UPDATE customer_registrations 
       SET registration_status = 'rejected', rejection_reason = :reason, reviewed_by = :reviewerId, reviewed_at = NOW()
       WHERE id = :id`,
      { id, reason, reviewerId: req.auth.userId }
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * PASSWORD MANAGEMENT
 */

authRouter.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const pool = getPool();

    const [[user]] = await pool.execute(
      `SELECT password_hash FROM auth_users WHERE id = :id LIMIT 1`,
      { id: req.auth.userId }
    );

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) {
      const e = new Error('Current password is incorrect');
      e.status = 401;
      throw e;
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.execute(
      `UPDATE auth_users SET password_hash = :ph WHERE id = :id`,
      { ph: hashed, id: req.auth.userId }
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * SESSION MANAGEMENT
 */

authRouter.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT id, issued_at, expires_at, user_agent, ip_address 
       FROM refresh_tokens 
       WHERE user_id = :userId AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY issued_at DESC`,
      { userId: req.auth.userId }
    );
    res.json({ sessions: rows });
  } catch (err) {
    next(err);
  }
});

authRouter.delete('/sessions/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    await pool.execute(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = :id AND user_id = :userId`,
      { id, userId: req.auth.userId }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const ApplicationOtpRequestSchema = z.object({
  phone: z.string().min(10),
  email: z.string().email(),
});

const ApplicationOtpVerifySchema = z.object({
  phone: z.string().min(10),
  otp: z.string().length(6),
  email: z.string().email(),
  fullName: z.string().min(1).optional(),
});

function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

authRouter.post('/application/request-otp', async (req, res, next) => {
  try {
    const input = ApplicationOtpRequestSchema.parse(req.body);
    const phone = normalizePhone(input.phone);
    const pool = getPool();
    const otp = generateOtp();
    const id = newId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.execute(
      `INSERT INTO lead_otps (id, lead_id, email, phone, otp_hash, purpose, channel, expires_at)
       VALUES (:id, NULL, :email, :phone, :hash, 'application_submit', 'sms', :exp)`,
      {
        id,
        email: input.email,
        phone,
        hash: hashOtp(otp),
        exp: expiresAt,
      },
    );

    await sendOtpNotification({ phone, email: input.email, otp, channel: 'sms' });
    res.json({ success: true, expiresInSeconds: 600 });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/application/verify-otp', async (req, res, next) => {
  try {
    const input = ApplicationOtpVerifySchema.parse(req.body);
    const phone = normalizePhone(input.phone);
    const pool = getPool();

    const [[otpRow]] = await pool.execute(
      `SELECT id FROM lead_otps
       WHERE phone = :phone AND otp_hash = :hash AND purpose = 'application_submit'
         AND verified_at IS NULL AND expires_at > NOW(3)
       ORDER BY created_at DESC LIMIT 1`,
      { phone, hash: hashOtp(input.otp) },
    );

    if (!otpRow) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    await pool.execute(`UPDATE lead_otps SET verified_at = NOW(3) WHERE id = :id`, { id: otpRow.id });

    let [[profile]] = await pool.execute(
      `SELECT id, email, role FROM user_profiles
       WHERE phone = :phone OR email = :email
       ORDER BY (phone = :phone) DESC
       LIMIT 1`,
      { phone, email: input.email },
    );

    let userId;
    let email = input.email;
    let role = 'customer';

    if (!profile) {
      userId = newId();
      const password = `RFC${crypto.randomBytes(4).toString('hex')}A1!`;
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.execute(
        `INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)`,
        { id: userId, email: input.email, ph: passwordHash },
      );
      await pool.execute(
        `INSERT INTO user_profiles (id, email, full_name, phone, role, account_status, is_active)
         VALUES (:id, :email, :fullName, :phone, 'customer', 'active', 1)`,
        {
          id: userId,
          email: input.email,
          fullName: input.fullName ?? null,
          phone,
        },
      );
    } else {
      userId = profile.id;
      email = profile.email;
      role = profile.role;
      await pool.execute(
        `UPDATE user_profiles SET phone = COALESCE(phone, :phone), full_name = COALESCE(full_name, :fullName)
         WHERE id = :id`,
        { id: userId, phone, fullName: input.fullName ?? null },
      );
    }

    const { accessJwt, refreshJwt } = await issueTokens({ userId, email, role, req });
    setRefreshCookie(res, refreshJwt);

    res.json({
      verified: true,
      accessToken: accessJwt,
      user: { id: userId, email, role },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get(
  '/users',
  authenticate,
  authorize({ resource: 'users', action: 'read' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [users] = await pool.execute(
        `SELECT u.id, u.email, p.full_name, p.role, p.account_status, p.is_active, u.created_at
         FROM auth_users u
         LEFT JOIN user_profiles p ON u.id = p.id
         ORDER BY u.created_at DESC`
      );
      res.json({ users });
    } catch (err) {
      next(err);
    }
  }
);

