import { getPool } from './pool.js';
import { ensureAgentProfileSchema } from './ensureAgentProfileSchema.js';

let ensured = false;

export async function ensureEmployeeProfileSchema() {
  await ensureAgentProfileSchema();
  if (ensured) return;
  const pool = getPool();

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS employee_profile_otps (
      id CHAR(36) NOT NULL,
      employee_user_id CHAR(36) NOT NULL,
      purpose VARCHAR(48) NOT NULL,
      channel VARCHAR(16) NOT NULL,
      target_email VARCHAR(320) NULL,
      target_phone VARCHAR(32) NULL,
      otp_hash VARCHAR(64) NOT NULL,
      payload JSON NULL,
      verified_at DATETIME(3) NULL,
      expires_at DATETIME(3) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_employee_profile_otp_user (employee_user_id, purpose),
      KEY idx_employee_profile_otp_exp (expires_at)
    )
  `);

  ensured = true;
}
