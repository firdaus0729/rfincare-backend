import { getPool } from './pool.js';

let ensured = false;

export async function ensureAgentLearningSchema() {
  if (ensured) return;
  const pool = getPool();

  try {
    await pool.execute(
      `ALTER TABLE agent_learning_content
       ADD COLUMN audience VARCHAR(16) NOT NULL DEFAULT 'agent' AFTER content_type`,
    );
  } catch (err) {
    if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
  }
  try {
    await pool.execute(
      `ALTER TABLE agent_learning_content ADD COLUMN category_label VARCHAR(64) NULL AFTER description`,
    );
  } catch (err) {
    if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS agent_learning_content (
      id CHAR(36) NOT NULL,
      content_type VARCHAR(32) NOT NULL,
      audience VARCHAR(16) NOT NULL DEFAULT 'agent',
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      category_label VARCHAR(64) NULL,
      duration_label VARCHAR(64) NULL,
      file_name VARCHAR(255) NULL,
      file_path TEXT NULL,
      file_url TEXT NULL,
      mime_type VARCHAR(128) NULL,
      video_url TEXT NULL,
      is_new TINYINT(1) NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      uploaded_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_learning_active (is_active, sort_order),
      KEY idx_learning_type (content_type)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS agent_learning_progress (
      id CHAR(36) NOT NULL,
      agent_user_id CHAR(36) NOT NULL,
      content_id CHAR(36) NOT NULL,
      progress_percent INT NOT NULL DEFAULT 0,
      completed_at DATETIME(3) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_agent_learning_progress (agent_user_id, content_id),
      KEY idx_progress_agent (agent_user_id)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS employee_learning_progress (
      id CHAR(36) NOT NULL,
      employee_user_id CHAR(36) NOT NULL,
      content_id CHAR(36) NOT NULL,
      progress_percent INT NOT NULL DEFAULT 0,
      completed_at DATETIME(3) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_employee_learning_progress (employee_user_id, content_id),
      KEY idx_employee_progress_user (employee_user_id)
    )
  `);

  ensured = true;
}
