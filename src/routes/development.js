import { Router } from 'express';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { z } from 'zod';

import { BACKEND_ENV_PATH, resolveFrontendEnvPath } from '../lib/envPaths.js';
import {
  entriesToObject,
  objectToEntries,
  readEnvFile,
  serializeEnvEntries,
  writeEnvFile,
} from '../lib/envFile.js';
import { getSessionCookieOptions } from '../lib/cookieOptions.js';

export const developmentRouter = Router();

const DEV_PANEL_PASSWORD = 'dev123!@#';
const SESSION_COOKIE = 'dev_panel_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function isPanelEnabled() {
  if (process.env.VERCEL) {
    return process.env.ENABLE_DEV_PANEL === 'true';
  }
  return process.env.ENABLE_DEV_PANEL !== 'false';
}

function panelDisabled(_req, res) {
  return res.status(404).json({ error: 'Developer panel is disabled' });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verifyPassword(password) {
  const a = crypto.createHash('sha256').update(String(password)).digest();
  const b = crypto.createHash('sha256').update(DEV_PANEL_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function signSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const payload = JSON.stringify({
    exp: Date.now() + SESSION_TTL_MS,
    tokenHash: hashToken(token),
  });
  const sig = crypto
    .createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'dev-panel-fallback')
    .update(payload)
    .digest('hex');
  return { cookieValue: `${Buffer.from(payload).toString('base64url')}.${sig}`, token };
}

function verifySessionCookie(cookieValue) {
  if (!cookieValue || !cookieValue.includes('.')) return false;
  const [payloadB64, sig] = cookieValue.split('.');
  const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
  const expectedSig = crypto
    .createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'dev-panel-fallback')
    .update(payloadStr)
    .digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  const payload = JSON.parse(payloadStr);
  return payload.exp > Date.now();
}

function getDevSessionToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.cookies?.[SESSION_COOKIE] || null;
}

function requireDevSession(req, res, next) {
  if (!isPanelEnabled()) return panelDisabled(req, res);
  if (!verifySessionCookie(getDevSessionToken(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function reloadBackendEnv() {
  dotenv.config({ path: BACKEND_ENV_PATH, override: true });
}

developmentRouter.use((req, res, next) => {
  if (!isPanelEnabled()) return panelDisabled(req, res);
  return next();
});

developmentRouter.post('/login', (req, res) => {
  const { password } = z.object({ password: z.string() }).parse(req.body);
  if (!verifyPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const { cookieValue } = signSession();
  res.cookie(SESSION_COOKIE, cookieValue, getSessionCookieOptions('/development-panel', SESSION_TTL_MS));
  return res.json({ success: true, sessionToken: cookieValue });
});

developmentRouter.post('/logout', (req, res) => {
  const opts = getSessionCookieOptions('/development-panel', 0);
  res.clearCookie(SESSION_COOKIE, { path: opts.path, secure: opts.secure, sameSite: opts.sameSite });
  return res.json({ success: true });
});

developmentRouter.get('/session', (req, res) => {
  return res.json({ authenticated: verifySessionCookie(getDevSessionToken(req)) });
});

developmentRouter.get('/env', requireDevSession, async (req, res, next) => {
  try {
    const frontendTarget = await resolveFrontendEnvPath();
    const [backend, frontend] = await Promise.all([
      readEnvFile(BACKEND_ENV_PATH),
      readEnvFile(frontendTarget.path),
    ]);
    res.json({
      backend: {
        path: BACKEND_ENV_PATH,
        content: backend.content,
        variables: entriesToObject(backend.entries),
      },
      frontend: {
        path: frontendTarget.path,
        storageMode: frontendTarget.storageMode,
        hint: frontendTarget.hint,
        content: frontend.content,
        variables: entriesToObject(frontend.entries),
      },
    });
  } catch (err) {
    next(err);
  }
});

const SaveSchema = z.object({
  target: z.enum(['backend', 'frontend']),
  content: z.string().optional(),
  variables: z.record(z.string()).optional(),
});

developmentRouter.put('/env', requireDevSession, async (req, res, next) => {
  try {
    const input = SaveSchema.parse(req.body);
    const saved = [];

    async function resolveContent(filePath, variables) {
      if (variables) {
        const existing = await readEnvFile(filePath);
        return serializeEnvEntries(objectToEntries(variables, existing.entries));
      }
      return input.content ?? '';
    }

    if (input.target === 'backend') {
      const content = await resolveContent(BACKEND_ENV_PATH, input.variables);
      await writeEnvFile(BACKEND_ENV_PATH, content);
      saved.push('backend');
      reloadBackendEnv();
    }

    let frontendMessage = null;
    if (input.target === 'frontend') {
      const frontendTarget = await resolveFrontendEnvPath();
      const content = await resolveContent(frontendTarget.path, input.variables);
      await writeEnvFile(frontendTarget.path, content);
      saved.push('frontend');
      frontendMessage =
        frontendTarget.storageMode === 'server-store'
          ? frontendTarget.hint
          : 'Frontend .env saved. Reload the page or restart the Vite dev server to apply VITE_* values.';
    }

    res.json({
      success: true,
      saved,
      message:
        frontendMessage
        || 'Environment files updated. Backend variables are active immediately.',
    });
  } catch (err) {
    next(err);
  }
});
