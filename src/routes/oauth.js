import { Router } from 'express';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { sha256Hex } from '../lib/crypto.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { getOAuthFrontendCallback, getPublicSiteOrigin } from '../lib/publicUrl.js';

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

function getRedirectUri(provider) {
  return `${getPublicSiteOrigin()}/auth/oauth/${provider}/callback`;
}

function getFrontendCallbackUrl() {
  return getOAuthFrontendCallback();
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
      `SELECT id, email, role FROM user_profiles WHERE id = :id LIMIT 1`,
      { id: existingOAuth.user_id },
    );
    return profile;
  }

  if (email) {
    const [[byEmail]] = await pool.execute(
      `SELECT id, email, role FROM user_profiles WHERE email = :email LIMIT 1`,
      { email },
    );
    if (byEmail) {
      await pool.execute(
        `INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email)
         VALUES (:id, :uid, :p, :pid, :email)`,
        { id: newId(), uid: byEmail.id, p: provider, pid: providerUserId, email },
      );
      return byEmail;
    }
  }

  const userId = newId();
  const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const userEmail = email || `${provider}_${providerUserId}@oauth.rfincare.local`;

  await pool.execute(
    `INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)`,
    { id: userId, email: userEmail, ph: placeholderHash },
  );
  await pool.execute(
    `INSERT INTO user_profiles (id, email, full_name, role, account_status, is_active)
     VALUES (:id, :email, :name, 'customer', 'active', 1)`,
    { id: userId, email: userEmail, name: fullName ?? null },
  );
  await pool.execute(
    `INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email)
     VALUES (:id, :uid, :p, :pid, :email)`,
    { id: newId(), uid: userId, p: provider, pid: providerUserId, email: userEmail },
  );

  return { id: userId, email: userEmail, role: 'customer' };
}

oauthRouter.get('/:provider', (req, res) => {
  const provider = req.params.provider;
  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: 'Unknown provider' });

  const clientIdKey = `OAUTH_${provider.toUpperCase()}_CLIENT_ID`;
  const clientId = process.env[clientIdKey];
  if (!clientId) return res.status(503).json({ error: `${provider} OAuth not configured` });

  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(`oauth_state_${provider}`, state, { httpOnly: true, maxAge: 600000, sameSite: 'lax' });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(provider),
    response_type: 'code',
    scope: cfg.scope,
    state,
  });
  if (provider === 'apple') {
    params.set('response_mode', 'form_post');
  }
  res.redirect(`${cfg.authUrl}?${params.toString()}`);
});

async function handleOAuthCallback(req, res, provider) {
  const cfg = PROVIDERS[provider];
  const code = req.query.code || req.body?.code;
  const state = req.query.state || req.body?.state;
  const cookieState = req.cookies?.[`oauth_state_${provider}`];

  if (!code || !state || state !== cookieState) {
    return res.redirect(`${getFrontendCallbackUrl()}?error=invalid_state`);
  }

  const clientId = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    return res.redirect(`${getFrontendCallbackUrl()}?error=not_configured`);
  }

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: getRedirectUri(provider),
    grant_type: 'authorization_code',
  });

  const tokenRes = await axios.post(cfg.tokenUrl, tokenBody.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

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
    return res.redirect(`${getFrontendCallbackUrl()}?error=no_user_id`);
  }

  const profile = await findOrCreateOAuthUser({ provider, providerUserId, email, fullName });
  const accessJwt = await issueTokensForUser({
    userId: profile.id,
    email: profile.email,
    role: profile.role,
    req,
    res,
  });

  const front = new URL(getFrontendCallbackUrl());
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
