import crypto from 'node:crypto';

import { getPool } from '../db/pool.js';
import { newId } from './ids.js';
import { getOAuthFrontendCallbackUrls } from './publicUrl.js';

export function hashResumeToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function pickFrontendOrigin(requestedOrigin) {
  const urls = getOAuthFrontendCallbackUrls();
  const origins = urls
    .map((url) => {
      try {
        return new URL(url).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (requestedOrigin) {
    const normalized = requestedOrigin.replace(/\/$/, '');
    if (origins.includes(normalized)) return normalized;
  }

  return origins[0] || 'http://127.0.0.1:4028';
}

export async function createResumeToken({ sessionKey, leadId, frontendOrigin, ttlDays = 7 }) {
  const pool = getPool();
  const token = crypto.randomBytes(24).toString('hex');
  const id = newId();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const origin = pickFrontendOrigin(frontendOrigin);

  await pool.execute(
    `INSERT INTO application_resume_tokens (id, session_key, lead_id, token_hash, expires_at)
     VALUES (:id, :sk, :lead_id, :hash, :exp)`,
    {
      id,
      sk: sessionKey,
      lead_id: leadId || null,
      hash: hashResumeToken(token),
      exp: expiresAt,
    },
  );

  return {
    url: `${origin}/resume-application/${token}`,
    expiresAt,
    token,
  };
}

export async function resolveResumeToken(token) {
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT r.session_key, r.lead_id, r.expires_at, r.used_at,
            d.loan_type, d.current_step, d.application_id
     FROM application_resume_tokens r
     LEFT JOIN application_form_drafts d ON d.session_key = r.session_key
     WHERE r.token_hash = :hash
     LIMIT 1`,
    { hash: hashResumeToken(token) },
  );

  if (!row) return null;
  if (row.used_at) return { error: 'already_used' };
  if (new Date(row.expires_at) < new Date()) return { error: 'expired' };

  await pool.execute(`UPDATE application_resume_tokens SET used_at = NOW(3) WHERE token_hash = :hash`, {
    hash: hashResumeToken(token),
  });

  return {
    sessionKey: row.session_key,
    leadId: row.lead_id,
    loanType: row.loan_type,
    currentStep: row.current_step,
    applicationId: row.application_id,
  };
}

export async function upsertLeadFromDraft({ sessionKey, formData, loanType, currentStep, applicationId }) {
  const email = formData?.email?.trim();
  const phone = (formData?.phone || '').replace(/\D/g, '').slice(-10);
  if (!email || phone.length !== 10) return null;

  const pool = getPool();
  const fullName = [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(' ');

  const [[existing]] = await pool.execute(
    `SELECT id FROM marketing_leads WHERE session_key = :sk OR (email = :email AND phone = :phone) LIMIT 1`,
    { sk: sessionKey, email, phone },
  );

  const status = currentStep >= 5 ? 'application_in_progress' : 'draft_started';

  if (existing?.id) {
    await pool.execute(
      `UPDATE marketing_leads SET
         full_name = COALESCE(:name, full_name),
         loan_type = COALESCE(:loan_type, loan_type),
         status = :status,
         session_key = :sk,
         application_id = COALESCE(:app_id, application_id)
       WHERE id = :id`,
      {
        id: existing.id,
        name: fullName || null,
        loan_type: loanType || null,
        status,
        sk: sessionKey,
        app_id: applicationId || null,
      },
    );
    return existing.id;
  }

  const id = newId();
  await pool.execute(
    `INSERT INTO marketing_leads (
       id, full_name, email, phone, loan_type, source, status, session_key, application_id
     ) VALUES (
       :id, :name, :email, :phone, :loan_type, 'assessment', :status, :sk, :app_id
     )`,
    {
      id,
      name: fullName || null,
      email,
      phone,
      loan_type: loanType || null,
      status,
      sk: sessionKey,
      app_id: applicationId || null,
    },
  );
  return id;
}
