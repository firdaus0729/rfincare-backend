import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let ensured = false;

async function tryAlter(sql) {
  const pool = getPool();
  try {
    await pool.execute(sql);
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

export async function ensureMilestone4Schema() {
  if (ensured) return;
  const pool = getPool();
  const sql = readFileSync(join(__dirname, '../../migrations/026_milestone4.sql'), 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--') && !s.startsWith('ALTER TABLE'));

  for (const statement of statements) {
    try {
      await pool.execute(statement);
    } catch (err) {
      if (err.code !== 'ER_TABLE_EXISTS_ERROR' && err.code !== 'ER_DUP_ENTRY') {
        throw err;
      }
    }
  }

  await tryAlter(
    `ALTER TABLE loan_applications ADD COLUMN journey_mode VARCHAR(32) NOT NULL DEFAULT 'assessment'`,
  );
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN cibil_status VARCHAR(32) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN cibil_checked_at DATETIME(3) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN disbursed_amount DECIMAL(15, 2) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN disbursed_at DATETIME(3) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN commission_status VARCHAR(32) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN commission_amount DECIMAL(15, 2) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN commission_rate DECIMAL(8, 4) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN tds_amount DECIMAL(15, 2) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN net_payout DECIMAL(15, 2) NULL`);
  await tryAlter(`ALTER TABLE loan_applications ADD COLUMN commission_paid_at DATETIME(3) NULL`);
  await tryAlter(
    `ALTER TABLE agent_onboarding ADD COLUMN qc_status VARCHAR(32) NOT NULL DEFAULT 'pending_qc'`,
  );
  await tryAlter(`ALTER TABLE agent_onboarding ADD COLUMN qc_employee_id CHAR(36) NULL`);
  await tryAlter(`ALTER TABLE agent_onboarding ADD COLUMN qc_notes TEXT NULL`);
  await tryAlter(`ALTER TABLE agent_onboarding ADD COLUMN qc_at DATETIME(3) NULL`);
  await tryAlter(`ALTER TABLE agent_onboarding ADD COLUMN qc_approved_by CHAR(36) NULL`);

  ensured = true;
}
