import { getPool } from './pool.js';

let ensured = false;

export async function ensureMilestone3Schema() {
  if (ensured) return;
  const pool = getPool();

  try {
    await pool.execute(
      'ALTER TABLE user_profiles ADD COLUMN customer_code VARCHAR(32) NULL AFTER phone',
    );
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }

  try {
    await pool.execute(
      'ALTER TABLE user_profiles ADD UNIQUE KEY uq_user_profiles_customer_code (customer_code)',
    );
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME' && err.code !== 'ER_CANT_CREATE_TABLE') {
      // ignore if index exists
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS interest_matrix_rates (
      id CHAR(36) NOT NULL,
      bank_id CHAR(36) NULL,
      product_type VARCHAR(128) NOT NULL,
      loan_type VARCHAR(64) NOT NULL DEFAULT 'Unsecured',
      credit_score_min INT NOT NULL DEFAULT 0,
      credit_score_max INT NOT NULL DEFAULT 900,
      loan_amount_min DECIMAL(15, 2) NOT NULL DEFAULT 0,
      loan_amount_max DECIMAL(15, 2) NOT NULL DEFAULT 0,
      term_min INT NOT NULL DEFAULT 0,
      term_max INT NOT NULL DEFAULT 0,
      interest_rate DECIMAL(6, 3) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      effective_date DATE NULL,
      change_note TEXT NULL,
      modified_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_interest_matrix_bank (bank_id),
      KEY idx_interest_matrix_product (product_type),
      KEY idx_interest_matrix_status (status)
    )
  `);

  try {
    await pool.execute('ALTER TABLE interest_matrix_rates ADD COLUMN bank_id CHAR(36) NULL AFTER id');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }

  try {
    await pool.execute('ALTER TABLE interest_matrix_rates ADD KEY idx_interest_matrix_bank (bank_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME' && err.code !== 'ER_CANT_CREATE_TABLE') {
      // ignore if index exists
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS report_schedules (
      id CHAR(36) NOT NULL,
      report_key VARCHAR(64) NOT NULL,
      report_name VARCHAR(255) NOT NULL,
      frequency VARCHAR(32) NOT NULL DEFAULT 'weekly',
      format VARCHAR(16) NOT NULL DEFAULT 'csv',
      recipients TEXT NOT NULL,
      filters_json JSON NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_run_at DATETIME(3) NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_report_schedules_key (report_key)
    )
  `);

  ensured = true;
}
