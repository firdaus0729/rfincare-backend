import { getPool } from '../db/pool.js';

export const AGENT_CODE_PREFIX = 'RFA';
const CODE_PATTERN = /^RFA-\d{6}$/;

/** Format: RFA-000001 (6-digit sequence). */
export function formatAgentCode(sequenceNumber) {
  const n = Math.max(1, Number(sequenceNumber) || 1);
  return `${AGENT_CODE_PREFIX}-${String(n).padStart(6, '0')}`;
}

export function isValidAgentCode(code) {
  return CODE_PATTERN.test(String(code || '').trim().toUpperCase());
}

async function nextSequenceNumber(pool) {
  const [[row]] = await pool.execute(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(agent_code, 5) AS UNSIGNED)), 0) AS max_seq
     FROM agent_onboarding
     WHERE agent_code REGEXP '^RFA-[0-9]{6}$'`,
  );
  return Number(row?.max_seq || 0) + 1;
}

/** Reserve a unique RFA agent code (retries on collision). */
export async function reserveUniqueAgentCode(connOrPool) {
  const pool = connOrPool?.execute ? connOrPool : getPool();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const seq = (await nextSequenceNumber(pool)) + attempt;
    const code = formatAgentCode(seq);
    const [[existing]] = await pool.execute(
      `SELECT id FROM agent_onboarding WHERE agent_code = :code LIMIT 1`,
      { code },
    );
    if (!existing) return code;
  }
  throw new Error('Could not reserve unique agent code');
}

/**
 * Assign RFA code when missing on agent_onboarding (existing agents included).
 * Returns the active code or null if no onboarding row exists.
 */
export async function ensureAgentCodeForUser(connOrPool, userId) {
  if (!userId) return null;
  const pool = connOrPool?.execute ? connOrPool : getPool();
  const [[row]] = await pool.execute(
    `SELECT agent_code FROM agent_onboarding WHERE user_id = :id LIMIT 1`,
    { id: userId },
  );
  if (!row) return null;

  const existing = String(row.agent_code || '').trim();
  if (existing) return existing;

  const code = await reserveUniqueAgentCode(pool);
  await pool.execute(
    `UPDATE agent_onboarding SET agent_code = :code, updated_at = NOW(3)
     WHERE user_id = :id AND (agent_code IS NULL OR TRIM(agent_code) = '')`,
    { code, id: userId },
  );
  return code;
}

let backfillDone = false;

/** One-time lazy backfill for agents created without a code. */
export async function backfillMissingAgentCodes(connOrPool) {
  if (backfillDone) return;
  const pool = connOrPool?.execute ? connOrPool : getPool();
  const [rows] = await pool.execute(
    `SELECT user_id FROM agent_onboarding
     WHERE agent_code IS NULL OR TRIM(agent_code) = ''`,
  );
  for (const row of rows) {
    await ensureAgentCodeForUser(pool, row.user_id);
  }
  backfillDone = true;
}
