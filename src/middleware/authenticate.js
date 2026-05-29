import { getPool } from '../db/pool.js';
import { verifyAccessToken } from '../lib/jwt.js';

export async function authenticate(req, _res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    if (!token) {
      const e = new Error('Missing access token');
      e.status = 401;
      throw e;
    }

    const payload = verifyAccessToken(token);
    const userId = payload.sub;

    const pool = getPool();
    const [[profile]] = await pool.execute(
      `SELECT id, email, role, account_status, is_active
       FROM user_profiles WHERE id = :id LIMIT 1`,
      { id: userId },
    );

    if (!profile) {
      const e = new Error('User profile not found');
      e.status = 404;
      throw e;
    }
    if (!profile.is_active || profile.account_status !== 'active') {
      const e = new Error('Account is not active');
      e.status = 403;
      throw e;
    }

    req.auth = { userId: profile.id, role: profile.role, email: profile.email, profile };
    next();
  } catch (err) {
    if (err?.name === 'TokenExpiredError' || err?.name === 'JsonWebTokenError') {
      const e = new Error('Unauthorized');
      e.status = 401;
      return next(e);
    }
    next(err);
  }
}

