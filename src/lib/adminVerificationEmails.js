import { ensureAdminProfileSchema } from '../db/ensureAdminProfileSchema.js';
import { getPool } from '../db/pool.js';

const SETTINGS_ID = 'default';

function fromEnv() {
  return [
    process.env.ADMIN_VERIFIER_EMAIL_1,
    process.env.ADMIN_VERIFIER_EMAIL_2,
    process.env.ADMIN_VERIFIER_EMAIL_3,
  ]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);
}

export function maskEmail(email) {
  const value = String(email || '').trim();
  if (!value.includes('@')) return '—';
  const [local, domain] = value.split('@');
  if (!local || !domain) return '—';
  const visible = local.length <= 2 ? `${local[0]}*` : `${local.slice(0, 2)}***`;
  return `${visible}@${domain}`;
}

export async function getAdminVerifierEmails() {
  await ensureAdminProfileSchema();
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT verifier_email_1, verifier_email_2, verifier_email_3
     FROM admin_verification_settings WHERE id = :id LIMIT 1`,
    { id: SETTINGS_ID },
  );

  const fromDb = [row?.verifier_email_1, row?.verifier_email_2, row?.verifier_email_3]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);

  if (fromDb.length) return fromDb.slice(0, 3);
  return fromEnv().slice(0, 3);
}

export async function saveAdminVerifierEmails(emails, updatedBy) {
  await ensureAdminProfileSchema();
  const normalized = (emails || [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3);

  while (normalized.length < 3) normalized.push(null);

  const pool = getPool();
  await pool.execute(
    `INSERT INTO admin_verification_settings
       (id, verifier_email_1, verifier_email_2, verifier_email_3, updated_by, updated_at)
     VALUES (:id, :e1, :e2, :e3, :by, NOW(3))
     ON DUPLICATE KEY UPDATE
       verifier_email_1 = VALUES(verifier_email_1),
       verifier_email_2 = VALUES(verifier_email_2),
       verifier_email_3 = VALUES(verifier_email_3),
       updated_by = VALUES(updated_by),
       updated_at = VALUES(updated_at)`,
    {
      id: SETTINGS_ID,
      e1: normalized[0],
      e2: normalized[1],
      e3: normalized[2],
      by: updatedBy || null,
    },
  );

  return normalized.filter(Boolean);
}

export async function collectOtpRecipientEmails(adminEmail) {
  const verifiers = await getAdminVerifierEmails();
  const admin = String(adminEmail || '')
    .trim()
    .toLowerCase();
  const all = [...new Set([admin, ...verifiers].filter(Boolean))];
  return { recipients: all, verifiers, adminEmail: admin || null };
}
