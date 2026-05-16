import { getPool } from './pool.js';

let ensured = false;

export async function ensureApprovalMatrixSchema() {
  if (ensured) return;
  const pool = getPool();
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS approval_matrix_rules (
      id CHAR(36) NOT NULL,
      bank_id CHAR(36) NOT NULL,
      rule_name VARCHAR(255) NULL,
      priority INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      approval_probability INT NULL,
      data JSON NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_approval_rules_bank_id (bank_id)
    )
  `);
  ensured = true;
}
