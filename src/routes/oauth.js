import { Router } from 'express';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { assignUniqueCustomerCode } from '../lib/customerCode.js';
import { ensureMilestone3Schema } from '../db/ensureMilestone3Schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { checkCustomerEmailForOAuth } from '../lib/oauthCustomerEligibility.js';
import {
  getOAuthCredentials,
  getOAuthProviderConfig,
  getOAuthRedirectUri,
  getPublicOAuthConfig,
} from '../lib/oauthProviderSettings.js';
import {
  isAllowedOAuthFrontendCallbackAsync,
  resolveOAuthFrontendCallbackAsync,
} from '../lib/publicUrl.js';

export const oauthRouter = Router();

const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scope: 'openid email profile User.Read',
  },
  apple: {
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    scope: 'name email',
  },
};

function oauthCookieOptions(maxAgeMs = 600000) {
  const secure = process.env.API_COOKIE_SECURE === 'true' || Boolean(process.env.VERCEL);
  return {
    httpOnly: true,
    maxAge: maxAgeMs,
    sameSite: 'lax',
    secure,
    path: '/',
  };
}

async function getFrontendCallbackUrl(req, provider) {
  const fromCookie = req.cookies?.[`oauth_return_${provider}`];
  if (fromCookie && (await isAllowedOAuthFrontendCallbackAsync(fromCookie))) {
    return fromCookie;
  }
  const urls = await import('../lib/publicUrl.js').then((m) => m.getOAuthFrontendCallbackUrlsAsync());
  return urls[0];
}

function setRefreshCookie(res, token) {
  const secure = process.env.API_COOKIE_SECURE === 'true' || Boolean(process.env.VERCEL);
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/auth/refresh',
    maxAge: Number(process.env.JWT_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 30) * 1000,
  });
}

async function issueTokensForUser({ userId, email, role, req, res }) {
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
      ip: req.socket?.remoteAddress ?? null,
    },
  );

  const accessJwt = signAccessToken({ userId, email, role });
  setRefreshCookie(res, refreshJwt);
  return accessJwt;
}

async function findOrCreateOAuthUser({ provider, providerUserId, email, fullName }) {
  const pool = getPool();
  const [[existingOAuth]] = await pool.execute(
    `SELECT user_id FROM oauth_identities WHERE provider = :p AND provider_user_id = :pid LIMIT 1`,
    { p: provider, pid: providerUserId },
  );
  if (existingOAuth) {
    const [[profile]] = await pool.execute(
      `SELECT id, email, role, is_active FROM user_profiles WHERE id = :id LIMIT 1`,
      { id: existingOAuth.user_id },
    );
    if (profile?.role !== 'customer') {
      const err = new Error('OAuth sign-in is only available for customer accounts.');
      err.code = 'staff_account';
      throw err;
    }
    if (profile?.is_active === 0) {
      const err = new Error('Your account is inactive. Contact support.');
      err.code = 'account_inactive';
      throw err;
    }
    return profile;
  }

  if (email) {
    const eligibility = await checkCustomerEmailForOAuth(email);
    if (!eligibility.allowed) {
      const err = new Error(
        eligibility.reason === 'not_registered'
          ? 'No application found for this email. Please apply on Rfincare first, then sign in with Google.'
          : 'This email cannot be used for customer sign-in.',
      );
      err.code = eligibility.reason || 'not_registered';
      throw err;
    }

    const [[byEmail]] = await pool.execute(
      `SELECT id, email, role, is_active FROM user_profiles WHERE LOWER(email) = LOWER(:email) LIMIT 1`,
      { email },
    );
    if (byEmail) {
      if (byEmail.role !== 'customer') {
        const err = new Error('OAuth sign-in is only available for customer accounts.');
        err.code = 'staff_account';
        throw err;
      }
      if (byEmail.is_active === 0) {
        const err = new Error('Your account is inactive. Contact support.');
        err.code = 'account_inactive';
        throw err;
      }
      await pool.execute(
        `INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email)
         VALUES (:id, :uid, :p, :pid, :email)`,
        { id: newId(), uid: byEmail.id, p: provider, pid: providerUserId, email },
      );
      return byEmail;
    }
  } else {
    const err = new Error('Email permission is required from your sign-in provider.');
    err.code = 'no_email';
    throw err;
  }

  const eligibility = await checkCustomerEmailForOAuth(email);
  if (!eligibility.allowed) {
    const err = new Error(
      'No application found for this email. Please apply on Rfincare first, then sign in with Google.',
    );
    err.code = eligibility.reason || 'not_registered';
    throw err;
  }

  const userId = newId();
  const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const userEmail = email.trim().toLowerCase();

  await pool.execute(
    `INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)`,
    { id: userId, email: userEmail, ph: placeholderHash },
  );
  await ensureMilestone3Schema();
  await pool.execute(
    `INSERT INTO user_profiles (id, email, full_name, role, account_status, is_active)
     VALUES (:id, :email, :name, 'customer', 'active', 1)`,
    { id: userId, email: userEmail, name: fullName ?? null },
  );
  await assignUniqueCustomerCode(pool, userId);
  await pool.execute(
    `INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email)
     VALUES (:id, :uid, :p, :pid, :email)`,
    { id: newId(), uid: userId, p: provider, pid: providerUserId, email: userEmail },
  );

  return { id: userId, email: userEmail, role: 'customer' };
}

oauthRouter.get('/config', async (_req, res, next) => {
  try {
    res.json(await getPublicOAuthConfig());
  } catch (err) {
    next(err);
  }
});

oauthRouter.get('/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    const cfg = PROVIDERS[provider];
    if (!cfg) return res.status(400).json({ error: 'Unknown provider' });

    const providerCfg = await getOAuthProviderConfig(provider);
    if (!providerCfg?.enabled) {
      const returnOrigin = req.query.return_origin?.toString().trim();
      const frontendCallback = await resolveOAuthFrontendCallbackAsync(returnOrigin);
      const front = new URL(frontendCallback);
      front.searchParams.set('error', 'provider_disabled');
      front.searchParams.set('provider', provider);
      return res.redirect(front.toString());
    }

    const credentials = await getOAuthCredentials(provider);
    if (!credentials?.clientId) {
      return res.status(503).json({ error: `${provider} OAuth credentials not configured` });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const returnOrigin = req.query.return_origin?.toString().trim();
    const frontendCallback = await resolveOAuthFrontendCallbackAsync(returnOrigin);
    const redirectUri = await getOAuthRedirectUri(provider);

    res.cookie(`oauth_state_${provider}`, state, oauthCookieOptions());
    res.cookie(`oauth_return_${provider}`, frontendCallback, oauthCookieOptions());

    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: cfg.scope,
      state,
    });
    if (provider === 'apple') {
      params.set('response_mode', 'form_post');
    }
    res.redirect(`${cfg.authUrl}?${params.toString()}`);
  } catch (err) {
    next(err);
  }
});

async function handleOAuthCallback(req, res, provider) {
  const cfg = PROVIDERS[provider];
  const code = req.query.code || req.body?.code;
  const state = req.query.state || req.body?.state;
  const cookieState = req.cookies?.[`oauth_state_${provider}`];

  const callbackUrl = await getFrontendCallbackUrl(req, provider);

  if (!code || !state || state !== cookieState) {
    return res.redirect(`${callbackUrl}?error=invalid_state`);
  }

  const credentials = await getOAuthCredentials(provider);
  if (!credentials?.clientId || !credentials?.clientSecret) {
    return res.redirect(`${callbackUrl}?error=not_configured`);
  }

  const redirectUri = await getOAuthRedirectUri(provider);

  const tokenBody = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  let tokenRes;
  try {
    tokenRes = await axios.post(cfg.tokenUrl, tokenBody.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (axiosErr) {
    console.error('[oauth] token exchange failed', axiosErr?.response?.data || axiosErr.message);
    return res.redirect(`${callbackUrl}?error=token_exchange_failed`);
  }

  const { access_token: providerAccessToken, id_token: idToken } = tokenRes.data;

  let email = null;
  let fullName = null;
  let providerUserId = null;

  if (provider === 'google') {
    const userRes = await axios.get(cfg.userInfoUrl, {
      headers: { Authorization: `Bearer ${providerAccessToken}` },
    });
    email = userRes.data.email;
    fullName = userRes.data.name;
    providerUserId = userRes.data.sub;
  } else if (provider === 'microsoft') {
    const userRes = await axios.get(cfg.userInfoUrl, {
      headers: { Authorization: `Bearer ${providerAccessToken}` },
    });
    email = userRes.data.mail || userRes.data.userPrincipalName;
    fullName = userRes.data.displayName;
    providerUserId = userRes.data.id;
  } else if (provider === 'apple' && idToken) {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    email = payload.email;
    providerUserId = payload.sub;
  }

  if (!providerUserId) {
    return res.redirect(`${callbackUrl}?error=no_user_id`);
  }

  let profile;
  try {
    profile = await findOrCreateOAuthUser({ provider, providerUserId, email, fullName });
  } catch (err) {
    const code = err.code || 'oauth_denied';
    return res.redirect(`${callbackUrl}?error=${encodeURIComponent(code)}`);
  }

  if (profile.role !== 'customer') {
    return res.redirect(`${callbackUrl}?error=staff_account`);
  }

  const accessJwt = await issueTokensForUser({
    userId: profile.id,
    email: profile.email,
    role: profile.role,
    req,
    res,
  });

  res.clearCookie(`oauth_return_${provider}`, { path: '/' });
  res.clearCookie(`oauth_state_${provider}`, { path: '/' });

  const front = new URL(callbackUrl);
  front.searchParams.set('accessToken', accessJwt);
  front.searchParams.set('provider', provider);
  res.redirect(front.toString());
}

oauthRouter.get('/:provider/callback', async (req, res, next) => {
  try {
    await handleOAuthCallback(req, res, req.params.provider);
  } catch (err) {
    next(err);
  }
});

oauthRouter.post('/apple/callback', async (req, res, next) => {
  try {
    await handleOAuthCallback(req, res, 'apple');
  } catch (err) {
    next(err);
  }
});
